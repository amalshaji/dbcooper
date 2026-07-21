use std::sync::Arc;

use dbcooper_lib::database::pool_manager::PoolManager;
use dbcooper_lib::mcp::server::start_mcp_server;
use reqwest::header::{HeaderMap, ACCEPT, AUTHORIZATION, CONTENT_TYPE};
use serde_json::{json, Value};
use sqlx::sqlite::SqlitePoolOptions;

const TOKEN: &str = "test-token-for-external-agent";
const ACCEPT_MCP: &str = "application/json, text/event-stream";

async fn sqlite_pool() -> sqlx::SqlitePool {
    let pool = SqlitePoolOptions::new()
        .max_connections(1)
        .connect("sqlite::memory:")
        .await
        .expect("create in-memory sqlite pool");

    sqlx::query(
        r#"
        CREATE TABLE connections (
            id INTEGER PRIMARY KEY,
            uuid TEXT NOT NULL,
            type TEXT NOT NULL DEFAULT 'database',
            name TEXT NOT NULL,
            host TEXT NOT NULL DEFAULT '',
            port INTEGER NOT NULL DEFAULT 0,
            database TEXT NOT NULL DEFAULT '',
            username TEXT NOT NULL DEFAULT '',
            password TEXT NOT NULL DEFAULT '',
            ssl INTEGER NOT NULL DEFAULT 0,
            db_type TEXT NOT NULL,
            file_path TEXT,
            ssh_enabled INTEGER NOT NULL DEFAULT 0,
            ssh_host TEXT NOT NULL DEFAULT '',
            ssh_port INTEGER NOT NULL DEFAULT 22,
            ssh_user TEXT NOT NULL DEFAULT '',
            ssh_password TEXT NOT NULL DEFAULT '',
            ssh_key_path TEXT NOT NULL DEFAULT '',
            ssh_use_key INTEGER NOT NULL DEFAULT 0,
            created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
            updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
        )
        "#,
    )
    .execute(&pool)
    .await
    .expect("create connections table");

    sqlx::query(
        r#"
        CREATE TABLE docker_connections (
            connection_uuid TEXT PRIMARY KEY,
            ownership TEXT NOT NULL,
            docker_context TEXT NOT NULL,
            container_id TEXT NOT NULL,
            container_name TEXT NOT NULL,
            engine TEXT NOT NULL,
            image TEXT NOT NULL,
            internal_port INTEGER NOT NULL,
            compose_project TEXT,
            compose_service TEXT,
            volume_name TEXT
        )
        "#,
    )
    .execute(&pool)
    .await
    .expect("create docker connections table");

    pool
}

async fn post_mcp(
    client: &reqwest::Client,
    url: &str,
    session_id: Option<&str>,
    body: Value,
) -> reqwest::Response {
    let mut request = client
        .post(url)
        .header(ACCEPT, ACCEPT_MCP)
        .header(CONTENT_TYPE, "application/json")
        .header(AUTHORIZATION, format!("Bearer {TOKEN}"))
        .json(&body);

    if let Some(session_id) = session_id {
        request = request.header("mcp-session-id", session_id);
    }

    request.send().await.expect("send MCP request")
}

async fn json_rpc_response(response: reqwest::Response) -> (HeaderMap, Value) {
    let status = response.status();
    let headers = response.headers().clone();
    let content_type = headers
        .get(reqwest::header::CONTENT_TYPE)
        .and_then(|value| value.to_str().ok())
        .unwrap_or("")
        .to_string();
    let body = response.text().await.expect("read MCP response body");

    assert!(
        status.is_success(),
        "unexpected MCP status {status}: {body}"
    );

    let json_text = if content_type.contains("text/event-stream") {
        body.lines()
            .filter_map(|line| line.strip_prefix("data: "))
            .find(|line| !line.is_empty())
            .unwrap_or_else(|| {
                panic!("SSE response should contain a non-empty data line; body was {body:?}")
            })
            .to_string()
    } else {
        body
    };

    let parsed = serde_json::from_str(&json_text)
        .unwrap_or_else(|error| panic!("parse JSON-RPC response from {json_text:?}: {error}"));
    (headers, parsed)
}

#[tokio::test]
async fn rejects_external_http_clients_without_bearer_token() {
    let handle = start_mcp_server(
        sqlite_pool().await,
        Arc::new(PoolManager::new()),
        TOKEN.into(),
    )
    .await
    .expect("start MCP server");
    let url = format!("http://127.0.0.1:{}/mcp", handle.port);
    let client = reqwest::Client::new();

    let response = client
        .post(&url)
        .header(ACCEPT, ACCEPT_MCP)
        .header(CONTENT_TYPE, "application/json")
        .json(&json!({"jsonrpc":"2.0","id":1,"method":"initialize","params":{}}))
        .send()
        .await
        .expect("send unauthenticated request");

    assert_eq!(response.status(), reqwest::StatusCode::UNAUTHORIZED);
    handle.stop().await;
}

#[tokio::test]
async fn stopping_server_waits_until_the_bound_port_is_released() {
    let handle = start_mcp_server(
        sqlite_pool().await,
        Arc::new(PoolManager::new()),
        TOKEN.into(),
    )
    .await
    .expect("start MCP server");
    let port = handle.port;

    handle.stop().await;

    let listener = tokio::net::TcpListener::bind(("127.0.0.1", port))
        .await
        .expect("stopped MCP server should release its port");
    drop(listener);
}

#[tokio::test]
async fn external_http_client_can_initialize_discover_and_call_tools() {
    let handle = start_mcp_server(
        sqlite_pool().await,
        Arc::new(PoolManager::new()),
        TOKEN.into(),
    )
    .await
    .expect("start MCP server");
    let url = format!("http://127.0.0.1:{}/mcp", handle.port);
    let client = reqwest::Client::new();

    let (headers, initialize) = json_rpc_response(
        post_mcp(
            &client,
            &url,
            None,
            json!({
                "jsonrpc": "2.0",
                "id": 1,
                "method": "initialize",
                "params": {
                    "protocolVersion": "2025-03-26",
                    "capabilities": {},
                    "clientInfo": {"name": "dbcooper-http-test", "version": "0.0.0"}
                }
            }),
        )
        .await,
    )
    .await;

    assert_eq!(initialize["id"], 1);
    assert_eq!(initialize["result"]["serverInfo"]["name"], "dbcooper-mcp");

    let session_id = headers
        .get("mcp-session-id")
        .and_then(|value| value.to_str().ok())
        .expect("initialize response should include MCP session id")
        .to_string();

    let initialized = post_mcp(
        &client,
        &url,
        Some(&session_id),
        json!({"jsonrpc":"2.0","method":"notifications/initialized"}),
    )
    .await;
    assert_eq!(initialized.status(), reqwest::StatusCode::ACCEPTED);

    let (_, tools) = json_rpc_response(
        post_mcp(
            &client,
            &url,
            Some(&session_id),
            json!({"jsonrpc":"2.0","id":2,"method":"tools/list","params":{}}),
        )
        .await,
    )
    .await;

    let tool_names: Vec<&str> = tools["result"]["tools"]
        .as_array()
        .expect("tools should be an array")
        .iter()
        .filter_map(|tool| tool["name"].as_str())
        .collect();
    assert!(tool_names.contains(&"list_connections"));
    assert!(tool_names.contains(&"execute_query"));

    let (_, list_connections) = json_rpc_response(
        post_mcp(
            &client,
            &url,
            Some(&session_id),
            json!({
                "jsonrpc":"2.0",
                "id":3,
                "method":"tools/call",
                "params":{"name":"list_connections","arguments":{}}
            }),
        )
        .await,
    )
    .await;

    assert_eq!(list_connections["id"], 3);
    assert_eq!(list_connections["result"]["isError"], false);

    handle.stop().await;
}

#[tokio::test]
async fn external_http_client_gets_consistent_bounded_read_only_results() {
    let temp_dir = tempfile::tempdir().expect("create temporary database directory");
    let database_path = temp_dir.path().join("mcp.db");
    let database_url = format!("sqlite://{}?mode=rwc", database_path.to_string_lossy());
    let database_pool = SqlitePoolOptions::new()
        .max_connections(1)
        .connect(&database_url)
        .await
        .expect("create MCP target database");
    sqlx::query("CREATE TABLE items (id INTEGER PRIMARY KEY)")
        .execute(&database_pool)
        .await
        .expect("create target table");
    sqlx::query(
        "WITH RECURSIVE rows(id) AS (SELECT 1 UNION ALL SELECT id + 1 FROM rows WHERE id < 1001) INSERT INTO items SELECT id FROM rows",
    )
    .execute(&database_pool)
    .await
    .expect("insert target rows");
    database_pool.close().await;

    let metadata_pool = sqlite_pool().await;
    sqlx::query(
        "INSERT INTO connections (uuid, name, db_type, file_path) VALUES (?, ?, 'sqlite', ?)",
    )
    .bind("mcp-sqlite")
    .bind("MCP SQLite")
    .bind(database_path.to_string_lossy().as_ref())
    .execute(&metadata_pool)
    .await
    .expect("save target connection");

    let handle = start_mcp_server(metadata_pool, Arc::new(PoolManager::new()), TOKEN.into())
        .await
        .expect("start MCP server");
    let url = format!("http://127.0.0.1:{}/mcp", handle.port);
    let client = reqwest::Client::new();

    let (headers, _) = json_rpc_response(
        post_mcp(
            &client,
            &url,
            None,
            json!({
                "jsonrpc": "2.0",
                "id": 1,
                "method": "initialize",
                "params": {
                    "protocolVersion": "2025-03-26",
                    "capabilities": {},
                    "clientInfo": {"name": "dbcooper-http-test", "version": "0.0.0"}
                }
            }),
        )
        .await,
    )
    .await;
    let session_id = headers
        .get("mcp-session-id")
        .and_then(|value| value.to_str().ok())
        .expect("initialize response should include MCP session id");
    let initialized = post_mcp(
        &client,
        &url,
        Some(session_id),
        json!({"jsonrpc":"2.0","method":"notifications/initialized"}),
    )
    .await;
    assert_eq!(initialized.status(), reqwest::StatusCode::ACCEPTED);

    let (_, execute_query) = json_rpc_response(
        post_mcp(
            &client,
            &url,
            Some(session_id),
            json!({
                "jsonrpc":"2.0",
                "id":2,
                "method":"tools/call",
                "params":{
                    "name":"execute_query",
                    "arguments":{
                        "connection_uuid":"mcp-sqlite",
                        "query":"SELECT id FROM items ORDER BY id"
                    }
                }
            }),
        )
        .await,
    )
    .await;

    assert_eq!(
        execute_query["result"]["isError"], false,
        "unexpected execute_query response: {execute_query}"
    );
    let text = execute_query["result"]["content"][0]["text"]
        .as_str()
        .expect("execute_query should return text");
    let json_text = text
        .split_once("\n\n(Results truncated")
        .map_or(text, |(json, _)| json);
    let result: Value = serde_json::from_str(json_text).expect("parse query result");
    assert_eq!(result["data"].as_array().unwrap().len(), 1000);
    assert_eq!(result["row_count"], 1000);
    assert_eq!(result["truncated"], true);

    let (_, write_query) = json_rpc_response(
        post_mcp(
            &client,
            &url,
            Some(session_id),
            json!({
                "jsonrpc":"2.0",
                "id":3,
                "method":"tools/call",
                "params":{
                    "name":"execute_query",
                    "arguments":{
                        "connection_uuid":"mcp-sqlite",
                        "query":"CREATE TABLE should_not_exist (id INTEGER)"
                    }
                }
            }),
        )
        .await,
    )
    .await;
    assert_eq!(write_query["result"]["isError"], true);

    let (_, attach_query) = json_rpc_response(
        post_mcp(
            &client,
            &url,
            Some(session_id),
            json!({
                "jsonrpc":"2.0",
                "id":4,
                "method":"tools/call",
                "params":{
                    "name":"execute_query",
                    "arguments":{
                        "connection_uuid":"mcp-sqlite",
                        "query":format!(
                            "ATTACH DATABASE '{}' AS attached",
                            database_path.to_string_lossy()
                        )
                    }
                }
            }),
        )
        .await,
    )
    .await;
    assert_eq!(attach_query["result"]["isError"], true);

    handle.stop().await;
}
