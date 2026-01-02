//! Integration tests for the ClickHouse database driver
//!
//! These tests verify the ClickHouse driver implementation of the DatabaseDriver trait.
//! Requires a running ClickHouse instance at localhost:8123 (use docker-compose up -d clickhouse)
//!
//! Run with: cargo test --test clickhouse_integration_tests -- --test-threads=1

use dbcooper_lib::database::clickhouse::{ClickhouseConfig, ClickhouseDriver, ClickhouseProtocol};
use dbcooper_lib::database::DatabaseDriver;

/// Helper function to create a test ClickHouse driver
fn create_test_driver() -> ClickhouseDriver {
    let config = ClickhouseConfig {
        host: "localhost".to_string(),
        port: 8123,
        database: "default".to_string(),
        username: "default".to_string(),
        password: "clickhouse".to_string(),
        protocol: ClickhouseProtocol::Http,
        ssl: false,
    };
    ClickhouseDriver::new(config)
}

/// Generate a unique test table name to avoid conflicts
fn test_table_name(prefix: &str) -> String {
    format!("test_{}_{}", prefix, uuid::Uuid::new_v4().simple())
}

/// Helper to clean up a test table
async fn drop_table(driver: &ClickhouseDriver, table: &str) {
    let _ = driver
        .execute_query(&format!("DROP TABLE IF EXISTS `{}`", table))
        .await;
}

// ============================================================================
// Connection Tests
// ============================================================================

#[tokio::test]
async fn test_connection_success() {
    let driver = create_test_driver();

    let result = driver.test_connection().await;
    assert!(result.is_ok(), "test_connection should not error");

    let test_result = result.unwrap();
    assert!(
        test_result.success,
        "Connection should succeed. Make sure ClickHouse is running (docker-compose up -d clickhouse). Message: {}",
        test_result.message
    );
    assert_eq!(test_result.message, "Connection successful!");
}

#[tokio::test]
async fn test_connection_failure() {
    let config = ClickhouseConfig {
        host: "localhost".to_string(),
        port: 18123, // Wrong port
        database: "default".to_string(),
        username: "default".to_string(),
        password: "clickhouse".to_string(),
        protocol: ClickhouseProtocol::Http,
        ssl: false,
    };
    let driver = ClickhouseDriver::new(config);

    let result = driver.test_connection().await;
    assert!(result.is_ok());

    let test_result = result.unwrap();
    assert!(
        !test_result.success,
        "Connection should fail with wrong port"
    );
    assert!(test_result.message.contains("Connection failed"));
}

// ============================================================================
// List Tables Tests
// ============================================================================

#[tokio::test]
async fn test_list_tables() {
    let driver = create_test_driver();
    let table_name = test_table_name("list");

    // Create a test table
    driver
        .execute_query(&format!(
            "CREATE TABLE `{}` (id UInt64, name String) ENGINE = Memory",
            table_name
        ))
        .await
        .expect("Failed to create test table");

    let result = driver.list_tables().await;
    assert!(result.is_ok());

    let tables = result.unwrap();
    let has_test_table = tables.iter().any(|t| t.name == table_name);
    assert!(has_test_table, "Should list the test table");

    // Verify table info structure
    let test_table = tables.iter().find(|t| t.name == table_name).unwrap();
    assert_eq!(test_table.schema, "default");
    assert_eq!(test_table.table_type, "Memory"); // Engine name

    // Cleanup
    drop_table(&driver, &table_name).await;
}

// ============================================================================
// Get Table Data Tests
// ============================================================================

#[tokio::test]
async fn test_get_table_data_empty_table() {
    let driver = create_test_driver();
    let table_name = test_table_name("empty");

    // Create an empty test table
    driver
        .execute_query(&format!(
            "CREATE TABLE `{}` (id UInt64, name String) ENGINE = Memory",
            table_name
        ))
        .await
        .expect("Failed to create test table");

    let result = driver
        .get_table_data("default", &table_name, 1, 10, None)
        .await;
    assert!(result.is_ok());

    let data = result.unwrap();
    assert!(data.data.is_empty(), "Empty table should return no rows");
    assert_eq!(data.total, 0, "Total should be 0");
    assert_eq!(data.page, 1);
    assert_eq!(data.limit, 10);

    // Cleanup
    drop_table(&driver, &table_name).await;
}

#[tokio::test]
async fn test_get_table_data_with_rows() {
    let driver = create_test_driver();
    let table_name = test_table_name("rows");

    // Create table with data
    driver
        .execute_query(&format!(
            "CREATE TABLE `{}` (id UInt64, name String) ENGINE = Memory",
            table_name
        ))
        .await
        .unwrap();

    driver
        .execute_query(&format!(
            "INSERT INTO `{}` VALUES (1, 'Alice'), (2, 'Bob'), (3, 'Charlie')",
            table_name
        ))
        .await
        .unwrap();

    let result = driver
        .get_table_data("default", &table_name, 1, 10, None)
        .await;
    assert!(result.is_ok());

    let data = result.unwrap();
    assert_eq!(data.data.len(), 3, "Should return 3 rows");
    assert_eq!(data.total, 3, "Total should be 3");

    // Cleanup
    drop_table(&driver, &table_name).await;
}

#[tokio::test]
async fn test_get_table_data_pagination() {
    let driver = create_test_driver();
    let table_name = test_table_name("page");

    // Create table with data
    driver
        .execute_query(&format!(
            "CREATE TABLE `{}` (id UInt64, name String) ENGINE = MergeTree() ORDER BY id",
            table_name
        ))
        .await
        .unwrap();

    // Insert 5 rows
    for i in 1..=5 {
        driver
            .execute_query(&format!(
                "INSERT INTO `{}` VALUES ({}, 'User{}')",
                table_name, i, i
            ))
            .await
            .unwrap();
    }

    // Get page 1 with limit 2
    let page1 = driver
        .get_table_data("default", &table_name, 1, 2, None)
        .await
        .unwrap();
    assert_eq!(page1.data.len(), 2, "Page 1 should have 2 rows");
    assert_eq!(page1.total, 5, "Total should be 5");

    // Get page 2 with limit 2
    let page2 = driver
        .get_table_data("default", &table_name, 2, 2, None)
        .await
        .unwrap();
    assert_eq!(page2.data.len(), 2, "Page 2 should have 2 rows");

    // Get page 3 with limit 2 (should have 1 row)
    let page3 = driver
        .get_table_data("default", &table_name, 3, 2, None)
        .await
        .unwrap();
    assert_eq!(page3.data.len(), 1, "Page 3 should have 1 row");

    // Cleanup
    drop_table(&driver, &table_name).await;
}

#[tokio::test]
async fn test_get_table_data_with_filter() {
    let driver = create_test_driver();
    let table_name = test_table_name("filter");

    // Create table with data
    driver
        .execute_query(&format!(
            "CREATE TABLE `{}` (id UInt64, age UInt32, name String) ENGINE = Memory",
            table_name
        ))
        .await
        .unwrap();

    driver
        .execute_query(&format!(
            "INSERT INTO `{}` VALUES (1, 30, 'Alice'), (2, 25, 'Bob'), (3, 35, 'Charlie')",
            table_name
        ))
        .await
        .unwrap();

    let result = driver
        .get_table_data("default", &table_name, 1, 10, Some("age > 25".to_string()))
        .await;
    assert!(result.is_ok());

    let data = result.unwrap();
    assert_eq!(data.data.len(), 2, "Should return 2 rows matching filter");
    assert_eq!(data.total, 2, "Total should be 2");

    // Cleanup
    drop_table(&driver, &table_name).await;
}

// ============================================================================
// Get Table Structure Tests
// ============================================================================

#[tokio::test]
async fn test_get_table_structure_columns() {
    let driver = create_test_driver();
    let table_name = test_table_name("struct");

    // Create a table with various column types
    driver
        .execute_query(&format!(
            "CREATE TABLE `{}` (
                id UInt64,
                name String,
                email Nullable(String),
                age UInt32 DEFAULT 0,
                created_at DateTime DEFAULT now()
            ) ENGINE = MergeTree() ORDER BY id",
            table_name
        ))
        .await
        .expect("Failed to create test table");

    let result = driver.get_table_structure("default", &table_name).await;
    assert!(result.is_ok());

    let structure = result.unwrap();
    assert_eq!(structure.columns.len(), 5, "Should have 5 columns");

    // Find the 'id' column
    let id_col = structure.columns.iter().find(|c| c.name == "id");
    assert!(id_col.is_some(), "Should have id column");
    let id_col = id_col.unwrap();
    assert!(id_col.primary_key, "id should be primary key");
    assert_eq!(id_col.data_type, "UInt64");

    // Find the 'email' column (Nullable)
    let email_col = structure.columns.iter().find(|c| c.name == "email");
    assert!(email_col.is_some(), "Should have email column");
    let email_col = email_col.unwrap();
    assert!(email_col.nullable, "email should be nullable");
    assert!(email_col.data_type.contains("Nullable"));

    // Find the 'age' column with default
    let age_col = structure.columns.iter().find(|c| c.name == "age");
    assert!(age_col.is_some(), "Should have age column");
    let age_col = age_col.unwrap();
    assert!(age_col.default.is_some(), "age should have default");

    // Cleanup
    drop_table(&driver, &table_name).await;
}

// ============================================================================
// Execute Query Tests
// ============================================================================

#[tokio::test]
async fn test_execute_query_select() {
    let driver = create_test_driver();
    let table_name = test_table_name("select");

    // Create table with data
    driver
        .execute_query(&format!(
            "CREATE TABLE `{}` (id UInt64, name String) ENGINE = Memory",
            table_name
        ))
        .await
        .unwrap();

    driver
        .execute_query(&format!("INSERT INTO `{}` VALUES (1, 'Test')", table_name))
        .await
        .unwrap();

    let result = driver
        .execute_query(&format!("SELECT * FROM `{}`", table_name))
        .await;
    assert!(result.is_ok());

    let query_result = result.unwrap();
    assert!(query_result.error.is_none(), "Should not have error");
    assert_eq!(query_result.row_count, 1);
    assert!(!query_result.data.is_empty());
    assert!(query_result.time_taken_ms.is_some());

    // Cleanup
    drop_table(&driver, &table_name).await;
}

#[tokio::test]
async fn test_execute_query_insert() {
    let driver = create_test_driver();
    let table_name = test_table_name("insert");

    // Create table
    driver
        .execute_query(&format!(
            "CREATE TABLE `{}` (id UInt64, name String) ENGINE = Memory",
            table_name
        ))
        .await
        .unwrap();

    let result = driver
        .execute_query(&format!("INSERT INTO `{}` VALUES (1, 'Test')", table_name))
        .await;
    assert!(result.is_ok());

    let query_result = result.unwrap();
    assert!(query_result.error.is_none(), "INSERT should succeed");

    // Verify insert
    let select_result = driver
        .execute_query(&format!("SELECT * FROM `{}`", table_name))
        .await
        .unwrap();
    assert_eq!(select_result.row_count, 1);

    // Cleanup
    drop_table(&driver, &table_name).await;
}

#[tokio::test]
async fn test_execute_query_syntax_error() {
    let driver = create_test_driver();

    let result = driver.execute_query("SELECTTTT * FROM nonexistent").await;
    assert!(result.is_ok());

    let query_result = result.unwrap();
    assert!(
        query_result.error.is_some(),
        "Should have error for invalid SQL"
    );
}

#[tokio::test]
async fn test_execute_query_show() {
    let driver = create_test_driver();

    let result = driver.execute_query("SHOW DATABASES").await;
    assert!(result.is_ok());

    let query_result = result.unwrap();
    assert!(query_result.error.is_none());
    assert!(query_result.row_count > 0, "Should return databases");
}

#[tokio::test]
async fn test_execute_query_describe() {
    let driver = create_test_driver();
    let table_name = test_table_name("desc");

    // Create table
    driver
        .execute_query(&format!(
            "CREATE TABLE `{}` (id UInt64, name String) ENGINE = Memory",
            table_name
        ))
        .await
        .unwrap();

    let result = driver
        .execute_query(&format!("DESCRIBE TABLE `{}`", table_name))
        .await;
    assert!(result.is_ok());

    let query_result = result.unwrap();
    assert!(query_result.error.is_none());
    assert_eq!(query_result.row_count, 2, "Should describe 2 columns");

    // Cleanup
    drop_table(&driver, &table_name).await;
}

// ============================================================================
// Get Schema Overview Tests
// ============================================================================

#[tokio::test]
async fn test_get_schema_overview() {
    let driver = create_test_driver();
    let table_name = test_table_name("schema");

    // Create a table
    driver
        .execute_query(&format!(
            "CREATE TABLE `{}` (
                id UInt64,
                name String
            ) ENGINE = MergeTree() ORDER BY id",
            table_name
        ))
        .await
        .unwrap();

    let result = driver.get_schema_overview().await;
    assert!(result.is_ok());

    let overview = result.unwrap();
    assert!(!overview.tables.is_empty(), "Should have tables");

    // Find our test table
    let test_table = overview.tables.iter().find(|t| t.name == table_name);
    assert!(test_table.is_some(), "Should include test table");

    let test_table = test_table.unwrap();
    assert_eq!(test_table.schema, "default");
    assert_eq!(test_table.columns.len(), 2);

    // Cleanup
    drop_table(&driver, &table_name).await;
}

// ============================================================================
// Data Type Tests
// ============================================================================

#[tokio::test]
async fn test_various_data_types() {
    let driver = create_test_driver();
    let table_name = test_table_name("types");

    // Create table with various ClickHouse types
    driver
        .execute_query(&format!(
            "CREATE TABLE `{}` (
                int_col Int64,
                uint_col UInt64,
                float_col Float64,
                str_col String,
                date_col Date,
                datetime_col DateTime,
                nullable_col Nullable(String),
                array_col Array(String)
            ) ENGINE = Memory",
            table_name
        ))
        .await
        .unwrap();

    driver
        .execute_query(&format!(
            "INSERT INTO `{}` VALUES (
                -42, 42, 3.14, 'hello', '2024-01-01', '2024-01-01 12:00:00', NULL, ['a', 'b', 'c']
            )",
            table_name
        ))
        .await
        .unwrap();

    let result = driver
        .execute_query(&format!("SELECT * FROM `{}`", table_name))
        .await
        .unwrap();

    assert_eq!(result.row_count, 1);
    let row = &result.data[0];

    // Verify data types are properly returned
    assert!(row.get("int_col").is_some());
    assert!(row.get("uint_col").is_some());
    assert!(row.get("float_col").is_some());
    assert!(row.get("str_col").is_some());
    assert!(row.get("date_col").is_some());
    assert!(row.get("datetime_col").is_some());
    assert!(row.get("array_col").is_some());

    // Cleanup
    drop_table(&driver, &table_name).await;
}

// ============================================================================
// Update/Delete Isolation Tests
// ============================================================================

#[tokio::test]
async fn test_alter_update_only_affects_targeted_row() {
    let driver = create_test_driver();
    let table_name = test_table_name("update");

    // Create a MergeTree table (required for ALTER UPDATE)
    driver
        .execute_query(&format!(
            "CREATE TABLE `{}` (
                id UInt64,
                name String,
                age UInt32
            ) ENGINE = MergeTree() ORDER BY id",
            table_name
        ))
        .await
        .unwrap();

    // Insert test data
    driver
        .execute_query(&format!(
            "INSERT INTO `{}` VALUES (1, 'Alice', 30), (2, 'Bob', 25), (3, 'Charlie', 35)",
            table_name
        ))
        .await
        .unwrap();

    // Wait for data to settle
    tokio::time::sleep(tokio::time::Duration::from_millis(100)).await;

    // ClickHouse uses ALTER TABLE...UPDATE for mutations
    let update_result = driver
        .execute_query(&format!(
            "ALTER TABLE `{}` UPDATE age = 99 WHERE name = 'Bob'",
            table_name
        ))
        .await;
    assert!(
        update_result.is_ok() && update_result.unwrap().error.is_none(),
        "ALTER UPDATE should succeed"
    );

    // Wait for mutation and force merge to see changes
    tokio::time::sleep(tokio::time::Duration::from_secs(1)).await;
    let _ = driver
        .execute_query(&format!("OPTIMIZE TABLE `{}` FINAL", table_name))
        .await;
    tokio::time::sleep(tokio::time::Duration::from_millis(500)).await;

    // Verify Bob was updated
    let bob = driver
        .execute_query(&format!(
            "SELECT age FROM `{}` WHERE name = 'Bob'",
            table_name
        ))
        .await
        .unwrap();

    if bob.row_count > 0 {
        let bob_age = bob.data[0]["age"].as_u64().or_else(|| {
            bob.data[0]["age"]
                .as_str()
                .and_then(|s| s.parse::<u64>().ok())
        });
        assert_eq!(bob_age, Some(99), "Bob's age should be updated");
    }

    // Verify Alice was NOT affected
    let alice = driver
        .execute_query(&format!(
            "SELECT age FROM `{}` WHERE name = 'Alice'",
            table_name
        ))
        .await
        .unwrap();
    assert!(alice.row_count > 0, "Alice should exist");
    let alice_age = alice.data[0]["age"].as_u64().or_else(|| {
        alice.data[0]["age"]
            .as_str()
            .and_then(|s| s.parse::<u64>().ok())
    });
    assert_eq!(alice_age, Some(30), "Alice's age should remain unchanged");

    // Verify Charlie was NOT affected
    let charlie = driver
        .execute_query(&format!(
            "SELECT age FROM `{}` WHERE name = 'Charlie'",
            table_name
        ))
        .await
        .unwrap();
    assert!(charlie.row_count > 0, "Charlie should exist");
    let charlie_age = charlie.data[0]["age"].as_u64().or_else(|| {
        charlie.data[0]["age"]
            .as_str()
            .and_then(|s| s.parse::<u64>().ok())
    });
    assert_eq!(
        charlie_age,
        Some(35),
        "Charlie's age should remain unchanged"
    );

    // Cleanup
    drop_table(&driver, &table_name).await;
}

#[tokio::test]
async fn test_alter_delete_only_affects_targeted_row() {
    let driver = create_test_driver();
    let table_name = test_table_name("delete");

    // Create a MergeTree table (required for ALTER DELETE)
    driver
        .execute_query(&format!(
            "CREATE TABLE `{}` (
                id UInt64,
                name String
            ) ENGINE = MergeTree() ORDER BY id",
            table_name
        ))
        .await
        .unwrap();

    // Insert test data
    driver
        .execute_query(&format!(
            "INSERT INTO `{}` VALUES (1, 'Alice'), (2, 'Bob'), (3, 'Charlie')",
            table_name
        ))
        .await
        .unwrap();

    tokio::time::sleep(tokio::time::Duration::from_millis(100)).await;

    // ClickHouse uses ALTER TABLE...DELETE for mutations
    let delete_result = driver
        .execute_query(&format!(
            "ALTER TABLE `{}` DELETE WHERE name = 'Bob'",
            table_name
        ))
        .await;
    assert!(
        delete_result.is_ok() && delete_result.unwrap().error.is_none(),
        "ALTER DELETE should succeed"
    );

    // Wait for mutation and force merge
    tokio::time::sleep(tokio::time::Duration::from_secs(1)).await;
    let _ = driver
        .execute_query(&format!("OPTIMIZE TABLE `{}` FINAL", table_name))
        .await;
    tokio::time::sleep(tokio::time::Duration::from_millis(500)).await;

    // Verify Bob was deleted
    let bob = driver
        .execute_query(&format!(
            "SELECT * FROM `{}` WHERE name = 'Bob'",
            table_name
        ))
        .await
        .unwrap();
    assert_eq!(bob.row_count, 0, "Bob should be deleted");

    // Verify Alice still exists
    let alice = driver
        .execute_query(&format!(
            "SELECT * FROM `{}` WHERE name = 'Alice'",
            table_name
        ))
        .await
        .unwrap();
    assert_eq!(alice.row_count, 1, "Alice should still exist");

    // Verify Charlie still exists
    let charlie = driver
        .execute_query(&format!(
            "SELECT * FROM `{}` WHERE name = 'Charlie'",
            table_name
        ))
        .await
        .unwrap();
    assert_eq!(charlie.row_count, 1, "Charlie should still exist");

    // Cleanup
    drop_table(&driver, &table_name).await;
}
