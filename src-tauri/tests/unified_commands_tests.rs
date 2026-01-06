//! Integration tests for unified database commands
//!
//! These tests verify the unified Tauri commands that dispatch to different database drivers.
//! Uses SQLite for testing as it doesn't require external services.
//!
//! Run with: cargo test --test unified_commands_tests -- --test-threads=1

use dbcooper_lib::commands::database::{
    delete_table_row, insert_table_row, unified_execute_query, unified_get_table_data,
    unified_get_table_structure, unified_list_tables, unified_test_connection, update_table_row,
};
use serde_json::json;
use tempfile::NamedTempFile;

/// Helper to create a temporary SQLite file path
fn temp_sqlite_path() -> String {
    let temp_file = NamedTempFile::new().expect("Failed to create temp file");
    temp_file.path().to_string_lossy().to_string()
}

/// Helper to generate unique table name
fn test_table_name(prefix: &str) -> String {
    format!("test_{}_{}", prefix, uuid::Uuid::new_v4().simple())
}

// ============================================================================
// unified_test_connection Tests
// ============================================================================

#[tokio::test]
async fn test_unified_test_connection_sqlite_success() {
    let file_path = temp_sqlite_path();

    let result = unified_test_connection(
        "sqlite".to_string(),
        None,
        None,
        None,
        None,
        None,
        None,
        Some(file_path),
    )
    .await;

    assert!(result.is_ok());
    let test_result = result.unwrap();
    assert!(test_result.success, "SQLite connection should succeed");
    assert_eq!(test_result.message, "Connection successful!");
}

#[tokio::test]
async fn test_unified_test_connection_postgres_success() {
    let result = unified_test_connection(
        "postgres".to_string(),
        Some("localhost".to_string()),
        Some(5432),
        Some("testdb".to_string()),
        Some("postgres".to_string()),
        Some("postgres".to_string()),
        Some(false),
        None,
    )
    .await;

    assert!(result.is_ok());
    let test_result = result.unwrap();
    assert!(
        test_result.success,
        "PostgreSQL connection should succeed. Message: {}",
        test_result.message
    );
}

#[tokio::test]
async fn test_unified_test_connection_invalid_db_type() {
    let result = unified_test_connection(
        "unknown_db".to_string(),
        None,
        None,
        None,
        None,
        None,
        None,
        None,
    )
    .await;

    assert!(result.is_err(), "Should error on unknown database type");
}

// ============================================================================
// unified_list_tables Tests
// ============================================================================

#[tokio::test]
async fn test_unified_list_tables_sqlite() {
    let file_path = temp_sqlite_path();
    let table_name = test_table_name("list");

    // First create a table using execute_query
    let _ = unified_execute_query(
        "sqlite".to_string(),
        None,
        None,
        None,
        None,
        None,
        None,
        Some(file_path.clone()),
        format!(
            "CREATE TABLE {} (id INTEGER PRIMARY KEY, name TEXT)",
            table_name
        ),
    )
    .await
    .unwrap();

    let result = unified_list_tables(
        "sqlite".to_string(),
        None,
        None,
        None,
        None,
        None,
        None,
        Some(file_path),
        None,
        None,
        None,
        None,
        None,
        None,
        None,
    )
    .await;

    assert!(result.is_ok());
    let tables = result.unwrap();
    assert!(
        tables.iter().any(|t| t.name == table_name),
        "Should list the created table"
    );
}

#[tokio::test]
async fn test_unified_list_tables_postgres() {
    let result = unified_list_tables(
        "postgres".to_string(),
        Some("localhost".to_string()),
        Some(5432),
        Some("testdb".to_string()),
        Some("postgres".to_string()),
        Some("postgres".to_string()),
        Some(false),
        None,
        None,
        None,
        None,
        None,
        None,
        None,
        None,
    )
    .await;

    assert!(result.is_ok(), "Should list PostgreSQL tables");
}

// ============================================================================
// unified_get_table_data Tests
// ============================================================================

#[tokio::test]
async fn test_unified_get_table_data_sqlite() {
    let file_path = temp_sqlite_path();
    let table_name = test_table_name("data");

    // Create table with data
    let _ = unified_execute_query(
        "sqlite".to_string(),
        None,
        None,
        None,
        None,
        None,
        None,
        Some(file_path.clone()),
        format!(
            "CREATE TABLE {} (id INTEGER PRIMARY KEY, name TEXT)",
            table_name
        ),
    )
    .await
    .unwrap();

    let _ = unified_execute_query(
        "sqlite".to_string(),
        None,
        None,
        None,
        None,
        None,
        None,
        Some(file_path.clone()),
        format!(
            "INSERT INTO {} (name) VALUES ('Alice'), ('Bob')",
            table_name
        ),
    )
    .await
    .unwrap();

    let result = unified_get_table_data(
        "sqlite".to_string(),
        None,
        None,
        None,
        None,
        None,
        None,
        Some(file_path),
        "main".to_string(),
        table_name,
        1,
        10,
        None,
        None,
        None,
    )
    .await;

    assert!(result.is_ok());
    let data = result.unwrap();
    assert_eq!(data.data.len(), 2, "Should return 2 rows");
    assert_eq!(data.total, 2);
}

#[tokio::test]
async fn test_unified_get_table_data_with_filter() {
    let file_path = temp_sqlite_path();
    let table_name = test_table_name("filter");

    // Create table with data
    let _ = unified_execute_query(
        "sqlite".to_string(),
        None,
        None,
        None,
        None,
        None,
        None,
        Some(file_path.clone()),
        format!(
            "CREATE TABLE {} (id INTEGER PRIMARY KEY, name TEXT, age INTEGER)",
            table_name
        ),
    )
    .await
    .unwrap();

    let _ = unified_execute_query(
        "sqlite".to_string(),
        None,
        None,
        None,
        None,
        None,
        None,
        Some(file_path.clone()),
        format!(
            "INSERT INTO {} (name, age) VALUES ('Alice', 30), ('Bob', 25), ('Charlie', 35)",
            table_name
        ),
    )
    .await
    .unwrap();

    let result = unified_get_table_data(
        "sqlite".to_string(),
        None,
        None,
        None,
        None,
        None,
        None,
        Some(file_path),
        "main".to_string(),
        table_name,
        1,
        10,
        Some("age > 25".to_string()),
        None,
        None,
    )
    .await;

    assert!(result.is_ok());
    let data = result.unwrap();
    assert_eq!(data.data.len(), 2, "Should return 2 rows matching filter");
}

// ============================================================================
// unified_get_table_structure Tests
// ============================================================================

#[tokio::test]
async fn test_unified_get_table_structure_sqlite() {
    let file_path = temp_sqlite_path();
    let table_name = test_table_name("struct");

    // Create table
    let _ = unified_execute_query(
        "sqlite".to_string(),
        None,
        None,
        None,
        None,
        None,
        None,
        Some(file_path.clone()),
        format!(
            "CREATE TABLE {} (id INTEGER PRIMARY KEY, name TEXT NOT NULL, email TEXT)",
            table_name
        ),
    )
    .await
    .unwrap();

    let result = unified_get_table_structure(
        "sqlite".to_string(),
        None,
        None,
        None,
        None,
        None,
        None,
        Some(file_path),
        "main".to_string(),
        table_name,
    )
    .await;

    assert!(result.is_ok());
    let structure = result.unwrap();
    assert_eq!(structure.columns.len(), 3, "Should have 3 columns");

    // Check column names exist
    assert!(structure.columns.iter().any(|c| c.name == "id"));
    assert!(structure.columns.iter().any(|c| c.name == "name"));
    assert!(structure.columns.iter().any(|c| c.name == "email"));
}

// ============================================================================
// unified_execute_query Tests
// ============================================================================

#[tokio::test]
async fn test_unified_execute_query_select() {
    let file_path = temp_sqlite_path();
    let table_name = test_table_name("exec");

    // Create table with data
    let _ = unified_execute_query(
        "sqlite".to_string(),
        None,
        None,
        None,
        None,
        None,
        None,
        Some(file_path.clone()),
        format!(
            "CREATE TABLE {} (id INTEGER PRIMARY KEY, name TEXT)",
            table_name
        ),
    )
    .await
    .unwrap();

    let _ = unified_execute_query(
        "sqlite".to_string(),
        None,
        None,
        None,
        None,
        None,
        None,
        Some(file_path.clone()),
        format!("INSERT INTO {} (name) VALUES ('Test')", table_name),
    )
    .await
    .unwrap();

    let result = unified_execute_query(
        "sqlite".to_string(),
        None,
        None,
        None,
        None,
        None,
        None,
        Some(file_path),
        format!("SELECT * FROM {}", table_name),
    )
    .await;

    assert!(result.is_ok());
    let query_result = result.unwrap();
    assert!(query_result.error.is_none());
    assert_eq!(query_result.row_count, 1);
}

#[tokio::test]
async fn test_unified_execute_query_syntax_error() {
    let file_path = temp_sqlite_path();

    let result = unified_execute_query(
        "sqlite".to_string(),
        None,
        None,
        None,
        None,
        None,
        None,
        Some(file_path),
        "SELECTTT * FROM nonexistent".to_string(),
    )
    .await;

    assert!(result.is_ok());
    let query_result = result.unwrap();
    assert!(query_result.error.is_some(), "Should have syntax error");
}

// ============================================================================
// update_table_row Tests
// ============================================================================

#[tokio::test]
async fn test_update_table_row_sqlite() {
    let file_path = temp_sqlite_path();
    let table_name = test_table_name("upd");

    // Create table with data
    let _ = unified_execute_query(
        "sqlite".to_string(),
        None,
        None,
        None,
        None,
        None,
        None,
        Some(file_path.clone()),
        format!(
            "CREATE TABLE {} (id INTEGER PRIMARY KEY, name TEXT, age INTEGER)",
            table_name
        ),
    )
    .await
    .unwrap();

    let _ = unified_execute_query(
        "sqlite".to_string(),
        None,
        None,
        None,
        None,
        None,
        None,
        Some(file_path.clone()),
        format!(
            "INSERT INTO {} (id, name, age) VALUES (1, 'Alice', 30)",
            table_name
        ),
    )
    .await
    .unwrap();

    // Update the row
    let mut updates = serde_json::Map::new();
    updates.insert("age".to_string(), json!(35));

    let result = update_table_row(
        "sqlite".to_string(),
        None,
        None,
        None,
        None,
        None,
        None,
        Some(file_path.clone()),
        "main".to_string(),
        table_name.clone(),
        vec!["id".to_string()],
        vec![json!(1)],
        updates,
    )
    .await;

    assert!(result.is_ok());
    let query_result = result.unwrap();
    assert!(query_result.error.is_none(), "Update should succeed");

    // Verify the update
    let select = unified_execute_query(
        "sqlite".to_string(),
        None,
        None,
        None,
        None,
        None,
        None,
        Some(file_path),
        format!("SELECT age FROM {} WHERE id = 1", table_name),
    )
    .await
    .unwrap();

    assert_eq!(
        select.data[0].get("age").unwrap().as_i64().unwrap(),
        35,
        "Age should be updated to 35"
    );
}

#[tokio::test]
async fn test_update_table_row_postgres() {
    let table_name = test_table_name("upd");

    // Create table
    let _ = unified_execute_query(
        "postgres".to_string(),
        Some("localhost".to_string()),
        Some(5432),
        Some("testdb".to_string()),
        Some("postgres".to_string()),
        Some("postgres".to_string()),
        Some(false),
        None,
        format!(
            "CREATE TABLE \"{}\" (id SERIAL PRIMARY KEY, name TEXT, age INTEGER)",
            table_name
        ),
    )
    .await
    .unwrap();

    // Insert data
    let _ = unified_execute_query(
        "postgres".to_string(),
        Some("localhost".to_string()),
        Some(5432),
        Some("testdb".to_string()),
        Some("postgres".to_string()),
        Some("postgres".to_string()),
        Some(false),
        None,
        format!(
            "INSERT INTO \"{}\" (name, age) VALUES ('Alice', 30)",
            table_name
        ),
    )
    .await
    .unwrap();

    // Get the inserted ID
    let select = unified_execute_query(
        "postgres".to_string(),
        Some("localhost".to_string()),
        Some(5432),
        Some("testdb".to_string()),
        Some("postgres".to_string()),
        Some("postgres".to_string()),
        Some(false),
        None,
        format!("SELECT id FROM \"{}\" WHERE name = 'Alice'", table_name),
    )
    .await
    .unwrap();

    let id = select.data[0].get("id").unwrap().as_i64().unwrap();

    // Update the row
    let mut updates = serde_json::Map::new();
    updates.insert("age".to_string(), json!(99));

    let result = update_table_row(
        "postgres".to_string(),
        Some("localhost".to_string()),
        Some(5432),
        Some("testdb".to_string()),
        Some("postgres".to_string()),
        Some("postgres".to_string()),
        Some(false),
        None,
        "public".to_string(),
        table_name.clone(),
        vec!["id".to_string()],
        vec![json!(id)],
        updates,
    )
    .await;

    assert!(result.is_ok());

    // Cleanup
    let _ = unified_execute_query(
        "postgres".to_string(),
        Some("localhost".to_string()),
        Some(5432),
        Some("testdb".to_string()),
        Some("postgres".to_string()),
        Some("postgres".to_string()),
        Some(false),
        None,
        format!("DROP TABLE IF EXISTS \"{}\"", table_name),
    )
    .await;
}

// ============================================================================
// delete_table_row Tests
// ============================================================================

#[tokio::test]
async fn test_delete_table_row_sqlite() {
    let file_path = temp_sqlite_path();
    let table_name = test_table_name("del");

    // Create table with data
    let _ = unified_execute_query(
        "sqlite".to_string(),
        None,
        None,
        None,
        None,
        None,
        None,
        Some(file_path.clone()),
        format!(
            "CREATE TABLE {} (id INTEGER PRIMARY KEY, name TEXT)",
            table_name
        ),
    )
    .await
    .unwrap();

    let _ = unified_execute_query(
        "sqlite".to_string(),
        None,
        None,
        None,
        None,
        None,
        None,
        Some(file_path.clone()),
        format!(
            "INSERT INTO {} (id, name) VALUES (1, 'Alice'), (2, 'Bob')",
            table_name
        ),
    )
    .await
    .unwrap();

    // Delete one row
    let result = delete_table_row(
        "sqlite".to_string(),
        None,
        None,
        None,
        None,
        None,
        None,
        Some(file_path.clone()),
        "main".to_string(),
        table_name.clone(),
        vec!["id".to_string()],
        vec![json!(1)],
    )
    .await;

    assert!(result.is_ok());
    assert!(result.unwrap().error.is_none(), "Delete should succeed");

    // Verify deletion
    let select = unified_execute_query(
        "sqlite".to_string(),
        None,
        None,
        None,
        None,
        None,
        None,
        Some(file_path),
        format!("SELECT COUNT(*) as cnt FROM {}", table_name),
    )
    .await
    .unwrap();

    assert_eq!(
        select.data[0].get("cnt").unwrap().as_i64().unwrap(),
        1,
        "Should have 1 row remaining"
    );
}

// ============================================================================
// insert_table_row Tests
// ============================================================================

#[tokio::test]
async fn test_insert_table_row_sqlite() {
    let file_path = temp_sqlite_path();
    let table_name = test_table_name("ins");

    // Create table
    let _ = unified_execute_query(
        "sqlite".to_string(),
        None,
        None,
        None,
        None,
        None,
        None,
        Some(file_path.clone()),
        format!(
            "CREATE TABLE {} (id INTEGER PRIMARY KEY, name TEXT, age INTEGER)",
            table_name
        ),
    )
    .await
    .unwrap();

    // Insert a row
    let values = vec![
        json!({"column": "name", "value": "Alice"}),
        json!({"column": "age", "value": 30}),
    ];

    let result = insert_table_row(
        "sqlite".to_string(),
        None,
        None,
        None,
        None,
        None,
        None,
        Some(file_path.clone()),
        "main".to_string(),
        table_name.clone(),
        values,
    )
    .await;

    assert!(result.is_ok());
    assert!(result.unwrap().error.is_none(), "Insert should succeed");

    // Verify insertion
    let select = unified_execute_query(
        "sqlite".to_string(),
        None,
        None,
        None,
        None,
        None,
        None,
        Some(file_path),
        format!("SELECT * FROM {}", table_name),
    )
    .await
    .unwrap();

    assert_eq!(select.row_count, 1, "Should have 1 row");
    assert_eq!(
        select.data[0].get("name").unwrap().as_str().unwrap(),
        "Alice"
    );
}

#[tokio::test]
async fn test_insert_table_row_postgres() {
    let table_name = test_table_name("ins");

    // Create table
    let _ = unified_execute_query(
        "postgres".to_string(),
        Some("localhost".to_string()),
        Some(5432),
        Some("testdb".to_string()),
        Some("postgres".to_string()),
        Some("postgres".to_string()),
        Some(false),
        None,
        format!(
            "CREATE TABLE \"{}\" (id SERIAL PRIMARY KEY, name TEXT, age INTEGER)",
            table_name
        ),
    )
    .await
    .unwrap();

    // Insert a row
    let values = vec![
        json!({"column": "name", "value": "Bob"}),
        json!({"column": "age", "value": 25}),
    ];

    let result = insert_table_row(
        "postgres".to_string(),
        Some("localhost".to_string()),
        Some(5432),
        Some("testdb".to_string()),
        Some("postgres".to_string()),
        Some("postgres".to_string()),
        Some(false),
        None,
        "public".to_string(),
        table_name.clone(),
        values,
    )
    .await;

    assert!(result.is_ok());

    // Cleanup
    let _ = unified_execute_query(
        "postgres".to_string(),
        Some("localhost".to_string()),
        Some(5432),
        Some("testdb".to_string()),
        Some("postgres".to_string()),
        Some("postgres".to_string()),
        Some(false),
        None,
        format!("DROP TABLE IF EXISTS \"{}\"", table_name),
    )
    .await;
}
