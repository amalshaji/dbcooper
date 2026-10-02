//! Ask AI agent loop against a real SQLite database through the pool manager.
//!
//! Run with: cargo test --test ai_chat_tests

use async_trait::async_trait;
use dbcooper_lib::ai::chat::executor::PoolExecutor;
use dbcooper_lib::ai::chat::{
    run_chat, ChatExecutor, ChatModel, ChatStep, DescribeTarget, Engine, InspectLevel, Role, Turn,
    MAX_RESULT_ROWS,
};
use dbcooper_lib::database::pool_manager::PoolManager;
use serde_json::json;
use sqlx::sqlite::{SqliteConnectOptions, SqlitePoolOptions};
use std::str::FromStr;
use std::sync::{Arc, Mutex};

struct Fixture {
    _dir: tempfile::TempDir,
    executor: PoolExecutor,
    database_path: std::path::PathBuf,
}

async fn fixture() -> Fixture {
    let dir = tempfile::tempdir().unwrap();
    let database_path = dir.path().join("shop.db");
    let target = SqlitePoolOptions::new()
        .max_connections(1)
        .connect(&format!("sqlite://{}?mode=rwc", database_path.display()))
        .await
        .unwrap();
    for statement in [
        "CREATE TABLE orders (id INTEGER PRIMARY KEY, month TEXT NOT NULL, total REAL NOT NULL)",
        "INSERT INTO orders (month, total) VALUES ('2026-01', 10), ('2026-01', 5), ('2026-02', 30)",
        "CREATE TABLE events (id INTEGER PRIMARY KEY)",
        "WITH RECURSIVE n(id) AS (SELECT 1 UNION ALL SELECT id + 1 FROM n WHERE id < 1500) INSERT INTO events SELECT id FROM n",
    ] {
        sqlx::query(statement).execute(&target).await.unwrap();
    }
    target.close().await;

    let metadata = SqlitePoolOptions::new()
        .max_connections(1)
        .connect_with(
            SqliteConnectOptions::from_str("sqlite::memory:")
                .unwrap()
                .foreign_keys(true),
        )
        .await
        .unwrap();
    sqlx::migrate!("./migrations").run(&metadata).await.unwrap();
    sqlx::query(
        "INSERT INTO connections (uuid, type, name, host, port, database, username, password, db_type, file_path) VALUES ('shop', 'sqlite', 'Shop', '', 0, '', '', '', 'sqlite', ?)",
    )
    .bind(database_path.to_string_lossy().as_ref())
    .execute(&metadata)
    .await
    .unwrap();

    let pool_manager = Arc::new(PoolManager::new());
    pool_manager
        .ensure_connected(&metadata, "shop")
        .await
        .unwrap();
    Fixture {
        _dir: dir,
        executor: PoolExecutor::new(
            pool_manager,
            "shop".to_string(),
            Engine::Sql {
                db_type: "sqlite".to_string(),
            },
        ),
        database_path,
    }
}

#[tokio::test]
async fn executor_reads_schema_queries_and_describes_tables() {
    let fixture = fixture().await;

    let schema = fixture.executor.schema().await;
    assert!(schema.contains("orders"), "{schema}");
    assert!(schema.contains("total REAL"), "{schema}");

    let output = fixture
        .executor
        .query(&json!(
            "SELECT month, SUM(total) AS revenue FROM orders GROUP BY month ORDER BY month"
        ))
        .await
        .unwrap();
    assert_eq!(output.rows.len(), 2);
    assert_eq!(output.rows[1]["revenue"], 30.0);
    assert!(!output.truncated);

    let capped = fixture
        .executor
        .query(&json!("SELECT id FROM events"))
        .await
        .unwrap();
    assert_eq!(capped.rows.len(), MAX_RESULT_ROWS);
    assert!(capped.truncated);

    let structure = fixture
        .executor
        .describe(&DescribeTarget {
            table: Some("ORDERS".to_string()),
            database: None,
            collection: None,
        })
        .await
        .unwrap();
    assert_eq!(structure["columns"].as_array().unwrap().len(), 3);
}

#[tokio::test]
async fn executor_rejects_writes() {
    let fixture = fixture().await;

    for statement in [
        "DELETE FROM orders",
        "DROP TABLE orders",
        "WITH x AS (SELECT 1) UPDATE orders SET total = 0",
    ] {
        assert!(
            fixture.executor.query(&json!(statement)).await.is_err(),
            "{statement} should be rejected"
        );
    }
    assert!(fixture
        .executor
        .query(&json!({"sql": "SELECT 1"}))
        .await
        .is_err());

    let target = SqlitePoolOptions::new()
        .connect(&format!("sqlite://{}", fixture.database_path.display()))
        .await
        .unwrap();
    let (count,): (i64,) = sqlx::query_as("SELECT COUNT(*) FROM orders")
        .fetch_one(&target)
        .await
        .unwrap();
    assert_eq!(count, 3);
}

struct Scripted(Mutex<Vec<&'static str>>);

#[async_trait]
impl ChatModel for Scripted {
    async fn complete(&self, _system: &str, _transcript: &[Turn]) -> Result<String, String> {
        Ok(self.0.lock().unwrap().remove(0).to_string())
    }
}

#[tokio::test]
async fn agent_loop_answers_with_a_chartable_result() {
    let fixture = fixture().await;
    let model = Scripted(Mutex::new(vec![
        r#"{"action":"query","query":"DELETE FROM orders","inspect":"none"}"#,
        r#"{"action":"query","query":"SELECT month, SUM(total) AS revenue FROM orders GROUP BY month ORDER BY month","purpose":"Revenue by month","inspect":"summary"}"#,
        r#"{"action":"answer","text":"February had the most revenue.","step":2,"chart":{"type":"bar","x":"month","y":["revenue"]}}"#,
    ]));
    let events = Mutex::new(Vec::<ChatStep>::new());
    let record = |step: &ChatStep| events.lock().unwrap().push(step.clone());

    let content = run_chat(
        &model,
        &fixture.executor,
        "system",
        vec![Turn {
            role: Role::User,
            content: "Revenue by month?".to_string(),
        }],
        InspectLevel::Rows,
        &record,
    )
    .await;

    assert!(content.error.is_none(), "{:?}", content.error);
    assert!(content.steps[0].error.is_some());
    assert_eq!(content.steps[1].row_count, Some(2));
    assert_eq!(content.steps[1].inspect, Some(InspectLevel::Summary));
    let result = content.result.unwrap();
    assert_eq!(result.step, 2);
    assert_eq!(result.rows.len(), 2);
    assert_eq!(content.chart.unwrap()["type"], "bar");

    let events = events.lock().unwrap();
    assert_eq!(events.len(), 4);
    assert!(events[0].running && !events[1].running);
}

#[tokio::test]
async fn approved_writes_create_tables_and_insert_rows() {
    let fixture = fixture().await;
    let create = json!("CREATE TABLE notes (id INTEGER PRIMARY KEY, body TEXT NOT NULL)");
    let insert = json!("INSERT INTO notes (body) VALUES ('first'), ('second')");

    assert!(fixture.executor.validate_write(&create).is_ok());
    assert!(fixture.executor.validate_write(&json!({"sql": 1})).is_err());
    assert!(
        fixture.executor.query(&create).await.is_err(),
        "the read-only path must still reject DDL"
    );

    fixture.executor.execute_write(&create).await.unwrap();
    let inserted = fixture.executor.execute_write(&insert).await.unwrap();
    assert_eq!(inserted, Some(2));

    let rows = fixture
        .executor
        .query(&json!("SELECT body FROM notes ORDER BY id"))
        .await
        .unwrap();
    assert_eq!(rows.rows.len(), 2);
    assert!(fixture
        .executor
        .execute_write(&json!("INSERT INTO missing VALUES (1)"))
        .await
        .is_err());
}

#[tokio::test]
async fn agent_queries_are_limited_to_one_read_statement() {
    let fixture = fixture().await;
    for statement in [
        "SELECT 1; DELETE FROM orders",
        "ATTACH DATABASE '/tmp/other.db' AS other",
        "PRAGMA writable_schema = 1",
    ] {
        assert!(
            fixture.executor.query(&json!(statement)).await.is_err(),
            "{statement} should be rejected"
        );
    }
    assert!(fixture
        .executor
        .query(&json!("WITH t AS (SELECT 1 AS n) SELECT n FROM t;"))
        .await
        .is_ok());
}
