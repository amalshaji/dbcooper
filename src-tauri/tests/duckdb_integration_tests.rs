use dbcooper_lib::database::duckdb::DuckDbDriver;
use dbcooper_lib::database::{DatabaseDriver, DuckDbConfig};
use dbcooper_lib::db::models::{
    FilterCondition, FilterConjunction, FilterExpression, FilterOperator, TableFilter,
};
use serde_json::json;
use std::path::PathBuf;
use tempfile::{tempdir, TempDir};

fn create_driver(temp_dir: &TempDir) -> DuckDbDriver {
    let helper = std::env::var_os("DBCOOPER_DUCKDB_CLI")
        .map(PathBuf::from)
        .expect("DBCOOPER_DUCKDB_CLI must point to the DuckDB CLI");
    DuckDbDriver::with_helper_path(
        DuckDbConfig {
            file_path: temp_dir
                .path()
                .join("analytics.duckdb")
                .to_string_lossy()
                .to_string(),
        },
        helper,
    )
}

#[tokio::test]
async fn creates_a_database_and_lists_primary_catalog_objects() {
    let temp_dir = tempdir().unwrap();
    let driver = create_driver(&temp_dir);

    assert!(driver.test_connection().await.unwrap().success);
    driver
        .execute_query(
            "CREATE SCHEMA reporting; \
             CREATE TABLE reporting.events(id BIGINT PRIMARY KEY, name VARCHAR NOT NULL); \
             CREATE VIEW reporting.event_names AS SELECT name FROM reporting.events",
        )
        .await
        .unwrap();

    let objects = driver.list_tables().await.unwrap();
    assert!(objects.iter().any(|object| {
        object.schema == "reporting" && object.name == "events" && object.table_type == "table"
    }));
    assert!(objects.iter().any(|object| {
        object.schema == "reporting" && object.name == "event_names" && object.table_type == "view"
    }));
}

#[tokio::test]
async fn excludes_attached_catalogs_from_the_object_explorer() {
    let temp_dir = tempdir().unwrap();
    let driver = create_driver(&temp_dir);
    let attached_path = temp_dir.path().join("attached.duckdb");
    driver
        .execute_query(&format!(
            "CREATE TABLE primary_table(id INTEGER); \
             ATTACH '{}' AS attached; \
             CREATE TABLE attached.attached_table(id INTEGER)",
            attached_path.to_string_lossy().replace('\'', "''")
        ))
        .await
        .unwrap();

    let objects = driver.list_tables().await.unwrap();
    assert!(objects.iter().any(|object| object.name == "primary_table"));
    assert!(!objects.iter().any(|object| object.name == "attached_table"));

    let attached = driver
        .execute_query("SELECT COUNT(*) AS count FROM attached.attached_table")
        .await
        .unwrap();
    assert_eq!(attached.data[0]["count"], 0);
}

#[tokio::test]
async fn reads_pages_with_structured_filters_and_primary_key_ordering() {
    let temp_dir = tempdir().unwrap();
    let driver = create_driver(&temp_dir);
    driver
        .execute_query(
            "CREATE TABLE metrics(id INTEGER PRIMARY KEY, label VARCHAR, value DECIMAL(18, 2)); \
             INSERT INTO metrics VALUES (3, 'gamma', 30.5), (1, 'alpha', 10.5), (2, 'beta', 20.5)",
        )
        .await
        .unwrap();

    let filter = TableFilter::Structured(FilterExpression {
        conjunction: FilterConjunction::And,
        conditions: vec![FilterCondition {
            column: "value".to_string(),
            operator: FilterOperator::GreaterThan,
            value: Some(json!(15)),
        }],
    });
    let page = driver
        .get_table_data("main", "metrics", 1, 10, Some(filter), None, None)
        .await
        .unwrap();

    assert_eq!(page.total, 2);
    assert_eq!(page.data[0]["id"], 2);
    assert_eq!(page.data[1]["id"], 3);
    assert_eq!(page.data[0]["value"], "20.50");
}

#[tokio::test]
async fn orders_pages_by_every_composite_primary_key_column() {
    let temp_dir = tempdir().unwrap();
    let driver = create_driver(&temp_dir);
    driver
        .execute_query(
            "CREATE TABLE events(tenant_id INTEGER, sequence INTEGER, PRIMARY KEY (tenant_id, sequence)); \
             INSERT INTO events VALUES (1, 2), (2, 2), (1, 1), (2, 1)",
        )
        .await
        .unwrap();

    let page = driver
        .get_table_data("main", "events", 1, 10, None, None, None)
        .await
        .unwrap();
    let keys = page
        .data
        .iter()
        .map(|row| {
            (
                row["tenant_id"].as_i64().unwrap(),
                row["sequence"].as_i64().unwrap(),
            )
        })
        .collect::<Vec<_>>();

    assert_eq!(keys, vec![(1, 1), (1, 2), (2, 1), (2, 2)]);
}

#[tokio::test]
async fn exposes_structure_and_complex_values_without_precision_loss() {
    let temp_dir = tempdir().unwrap();
    let driver = create_driver(&temp_dir);
    driver
        .execute_query(
            "CREATE TABLE parent(id BIGINT PRIMARY KEY); \
             CREATE TABLE child(\
               id BIGINT PRIMARY KEY, \
               parent_id BIGINT REFERENCES parent(id), \
               tags VARCHAR[], \
               amount DECIMAL(38, 4), \
               payload BLOB\
             ); \
             INSERT INTO parent VALUES (1); \
             INSERT INTO child VALUES (9007199254740993, 1, ['a', 'b'], 123.4500, from_hex('CAFE'))",
        )
        .await
        .unwrap();

    let structure = driver.get_table_structure("main", "child").await.unwrap();
    assert!(structure.columns.iter().any(|column| column.primary_key));
    assert_eq!(structure.foreign_keys[0].references_table, "parent");

    let result = driver.execute_query("SELECT * FROM child").await.unwrap();
    assert_eq!(result.data[0]["id"], "9007199254740993");
    assert_eq!(result.data[0]["amount"], "123.4500");
    assert_eq!(result.data[0]["tags"], json!(["a", "b"]));
    assert_eq!(result.data[0]["payload"], "\\xCAFE");
}

#[tokio::test]
async fn read_only_execution_blocks_database_and_external_writes() {
    let temp_dir = tempdir().unwrap();
    let driver = create_driver(&temp_dir);
    driver
        .execute_query("CREATE TABLE events(id INTEGER); INSERT INTO events VALUES (1)")
        .await
        .unwrap();

    let result = driver
        .execute_query_read_only("SELECT COUNT(*) AS count FROM events")
        .await
        .unwrap();
    assert_eq!(result.data[0]["count"], 1);

    for query in [
        "INSERT INTO events VALUES (2)",
        "ATTACH ':memory:' AS other",
        "COPY events TO 'events.csv' (HEADER)",
        "SELECT * FROM read_csv_auto('missing.csv')",
        "INSTALL httpfs",
        "LOAD httpfs",
    ] {
        let result = driver.execute_query_read_only(query).await.unwrap();
        assert!(
            result.error.is_some(),
            "query unexpectedly succeeded: {query}"
        );
    }

    let result = driver
        .execute_query("INSERT INTO events VALUES (2)")
        .await
        .unwrap();
    assert!(result.error.is_none());
}

#[tokio::test]
async fn supports_duckdb_query_syntax_and_caps_results() {
    let temp_dir = tempdir().unwrap();
    let driver = create_driver(&temp_dir);

    let from_result = driver
        .execute_query("FROM range(3) t(value)")
        .await
        .unwrap();
    assert_eq!(from_result.row_count, 3);
    assert!(!from_result.truncated);

    let commented_from = driver
        .execute_query("-- generated query\nFROM range(2) t(value)")
        .await
        .unwrap();
    assert!(commented_from.error.is_none());
    assert_eq!(commented_from.row_count, 2);

    let capped = driver
        .execute_query("SELECT * FROM range(10001) t(value)")
        .await
        .unwrap();
    assert_eq!(capped.row_count, 10_000);
    assert!(capped.truncated);
}

#[tokio::test]
async fn keeps_the_session_usable_after_a_query_error() {
    let temp_dir = tempdir().unwrap();
    let driver = create_driver(&temp_dir);

    let failed = driver.execute_query("SELECT missing_column").await.unwrap();
    assert!(failed.error.is_some());

    let recovered = driver.execute_query("SELECT 1 AS value").await.unwrap();
    assert!(recovered.error.is_none());
    assert_eq!(recovered.data[0]["value"], 1);
}
