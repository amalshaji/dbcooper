//! Integration tests for the PostgreSQL database driver
//!
//! These tests verify the PostgreSQL driver implementation of the DatabaseDriver trait.
//! Requires a running PostgreSQL instance at localhost:5432 (use docker-compose up -d postgres)
//!
//! Run with: cargo test --test postgres_integration_tests -- --test-threads=1

use dbcooper_lib::database::postgres::PostgresDriver;
use dbcooper_lib::database::{DatabaseDriver, PostgresConfig};

/// Helper function to create a test PostgreSQL driver
fn create_test_driver() -> PostgresDriver {
    let config = PostgresConfig {
        host: "localhost".to_string(),
        port: 5432,
        database: "testdb".to_string(),
        username: "postgres".to_string(),
        password: "postgres".to_string(),
        ssl: false,
    };
    PostgresDriver::new(config)
}

/// Generate a unique test table name to avoid conflicts
fn test_table_name(prefix: &str) -> String {
    format!("test_{}_{}", prefix, uuid::Uuid::new_v4().simple())
}

/// Helper to clean up a test table
async fn drop_table(driver: &PostgresDriver, table: &str) {
    let _ = driver
        .execute_query(&format!("DROP TABLE IF EXISTS \"{}\" CASCADE", table))
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
        "Connection should succeed. Make sure PostgreSQL is running (docker-compose up -d postgres). Message: {}",
        test_result.message
    );
    assert_eq!(test_result.message, "Connection successful!");
}

#[tokio::test]
async fn test_connection_failure() {
    let config = PostgresConfig {
        host: "localhost".to_string(),
        port: 15432, // Wrong port
        database: "testdb".to_string(),
        username: "postgres".to_string(),
        password: "postgres".to_string(),
        ssl: false,
    };
    let driver = PostgresDriver::new(config);

    let result = driver.test_connection().await;
    assert!(result.is_ok());

    let test_result = result.unwrap();
    assert!(
        !test_result.success,
        "Connection should fail with wrong port"
    );
    assert!(
        test_result.message.contains("Connection failed")
            || test_result.message.contains("timed out")
    );
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
            "CREATE TABLE \"{}\" (id SERIAL PRIMARY KEY, name TEXT)",
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
    assert_eq!(test_table.schema, "public");
    assert_eq!(test_table.table_type, "table");

    // Cleanup
    drop_table(&driver, &table_name).await;
}

#[tokio::test]
async fn test_list_tables_excludes_system() {
    let driver = create_test_driver();

    let result = driver.list_tables().await;
    assert!(result.is_ok());

    let tables = result.unwrap();
    // Should not include pg_catalog or information_schema tables
    for table in &tables {
        assert!(
            table.schema != "pg_catalog" && table.schema != "information_schema",
            "Should not list system schema tables"
        );
    }
}

#[tokio::test]
async fn test_list_tables_includes_views() {
    let driver = create_test_driver();
    let table_name = test_table_name("tbl");
    let view_name = test_table_name("view");

    // Create a table and a view
    driver
        .execute_query(&format!(
            "CREATE TABLE \"{}\" (id SERIAL PRIMARY KEY, name TEXT)",
            table_name
        ))
        .await
        .unwrap();

    driver
        .execute_query(&format!(
            "CREATE VIEW \"{}\" AS SELECT * FROM \"{}\"",
            view_name, table_name
        ))
        .await
        .unwrap();

    let result = driver.list_tables().await;
    assert!(result.is_ok());

    let tables = result.unwrap();
    let view = tables.iter().find(|t| t.name == view_name);
    assert!(view.is_some(), "Should include view");
    assert_eq!(view.unwrap().table_type, "view");

    // Cleanup
    driver
        .execute_query(&format!("DROP VIEW IF EXISTS \"{}\"", view_name))
        .await
        .unwrap();
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
            "CREATE TABLE \"{}\" (id SERIAL PRIMARY KEY, name TEXT)",
            table_name
        ))
        .await
        .expect("Failed to create test table");

    let result = driver
        .get_table_data("public", &table_name, 1, 10, None, None, None)
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
            "CREATE TABLE \"{}\" (id SERIAL PRIMARY KEY, name TEXT)",
            table_name
        ))
        .await
        .unwrap();

    driver
        .execute_query(&format!(
            "INSERT INTO \"{}\" (name) VALUES ('Alice'), ('Bob'), ('Charlie')",
            table_name
        ))
        .await
        .unwrap();

    let result = driver
        .get_table_data("public", &table_name, 1, 10, None, None, None)
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
            "CREATE TABLE \"{}\" (id SERIAL PRIMARY KEY, name TEXT)",
            table_name
        ))
        .await
        .unwrap();

    // Insert 5 rows
    for i in 1..=5 {
        driver
            .execute_query(&format!(
                "INSERT INTO \"{}\" (name) VALUES ('User{}')",
                table_name, i
            ))
            .await
            .unwrap();
    }

    // Get page 1 with limit 2
    let page1 = driver
        .get_table_data("public", &table_name, 1, 2, None, None, None)
        .await
        .unwrap();
    assert_eq!(page1.data.len(), 2, "Page 1 should have 2 rows");
    assert_eq!(page1.total, 5, "Total should be 5");

    // Get page 2 with limit 2
    let page2 = driver
        .get_table_data("public", &table_name, 2, 2, None, None, None)
        .await
        .unwrap();
    assert_eq!(page2.data.len(), 2, "Page 2 should have 2 rows");

    // Get page 3 with limit 2 (should have 1 row)
    let page3 = driver
        .get_table_data("public", &table_name, 3, 2, None, None, None)
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
            "CREATE TABLE \"{}\" (id SERIAL PRIMARY KEY, name TEXT, age INTEGER)",
            table_name
        ))
        .await
        .unwrap();

    driver
        .execute_query(&format!(
            "INSERT INTO \"{}\" (name, age) VALUES ('Alice', 30), ('Bob', 25), ('Charlie', 35)",
            table_name
        ))
        .await
        .unwrap();

    let result = driver
        .get_table_data(
            "public",
            &table_name,
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
            "CREATE TABLE \"{}\" (
                id SERIAL PRIMARY KEY,
                name TEXT NOT NULL,
                email VARCHAR(255),
                age INTEGER DEFAULT 0,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            )",
            table_name
        ))
        .await
        .expect("Failed to create test table");

    let result = driver.get_table_structure("public", &table_name).await;
    assert!(result.is_ok());

    let structure = result.unwrap();
    assert_eq!(structure.columns.len(), 5, "Should have 5 columns");

    // Find the 'id' column
    let id_col = structure.columns.iter().find(|c| c.name == "id");
    assert!(id_col.is_some(), "Should have id column");
    let id_col = id_col.unwrap();
    assert!(id_col.primary_key, "id should be primary key");

    // Find the 'name' column
    let name_col = structure.columns.iter().find(|c| c.name == "name");
    assert!(name_col.is_some(), "Should have name column");
    let name_col = name_col.unwrap();
    assert!(!name_col.nullable, "name should NOT be nullable");

    // Find the 'email' column (nullable by default)
    let email_col = structure.columns.iter().find(|c| c.name == "email");
    assert!(email_col.is_some(), "Should have email column");
    let email_col = email_col.unwrap();
    assert!(email_col.nullable, "email should be nullable");

    // Find the 'age' column with default
    let age_col = structure.columns.iter().find(|c| c.name == "age");
    assert!(age_col.is_some(), "Should have age column");
    let age_col = age_col.unwrap();
    assert!(age_col.default.is_some(), "age should have default");

    // Cleanup
    drop_table(&driver, &table_name).await;
}

#[tokio::test]
async fn test_get_table_structure_indexes() {
    let driver = create_test_driver();
    let table_name = test_table_name("idx");

    // Create a table with an index
    driver
        .execute_query(&format!(
            "CREATE TABLE \"{}\" (id SERIAL PRIMARY KEY, name TEXT)",
            table_name
        ))
        .await
        .unwrap();

    driver
        .execute_query(&format!(
            "CREATE INDEX idx_{}_name ON \"{}\"(name)",
            table_name.replace("-", "_"),
            table_name
        ))
        .await
        .expect("Failed to create index");

    let result = driver.get_table_structure("public", &table_name).await;
    assert!(result.is_ok());

    let structure = result.unwrap();
    // Should have at least 2 indexes (primary key + our index)
    assert!(
        structure.indexes.len() >= 2,
        "Should have at least 2 indexes"
    );

    // Check for primary key index
    let pk_idx = structure.indexes.iter().find(|i| i.primary);
    assert!(pk_idx.is_some(), "Should have primary key index");

    // Cleanup
    drop_table(&driver, &table_name).await;
}

#[tokio::test]
async fn test_get_table_structure_foreign_keys() {
    let driver = create_test_driver();
    let parent_table = test_table_name("parent");
    let child_table = test_table_name("child");

    // Create parent table
    driver
        .execute_query(&format!(
            "CREATE TABLE \"{}\" (id SERIAL PRIMARY KEY, name TEXT)",
            parent_table
        ))
        .await
        .unwrap();

    // Create child table with foreign key
    driver
        .execute_query(&format!(
            "CREATE TABLE \"{}\" (
                id SERIAL PRIMARY KEY,
                parent_id INTEGER REFERENCES \"{}\"(id),
                name TEXT
            )",
            child_table, parent_table
        ))
        .await
        .expect("Failed to create child table");

    let result = driver.get_table_structure("public", &child_table).await;
    assert!(result.is_ok());

    let structure = result.unwrap();
    assert!(
        !structure.foreign_keys.is_empty(),
        "Should have foreign keys"
    );

    let fk = &structure.foreign_keys[0];
    assert_eq!(fk.column, "parent_id");
    assert_eq!(fk.references_table, parent_table);
    assert_eq!(fk.references_column, "id");

    // Cleanup
    drop_table(&driver, &child_table).await;
    drop_table(&driver, &parent_table).await;
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
            "CREATE TABLE \"{}\" (id SERIAL PRIMARY KEY, name TEXT)",
            table_name
        ))
        .await
        .unwrap();

    driver
        .execute_query(&format!(
            "INSERT INTO \"{}\" (name) VALUES ('Test')",
            table_name
        ))
        .await
        .unwrap();

    let result = driver
        .execute_query(&format!("SELECT * FROM \"{}\"", table_name))
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
            "CREATE TABLE \"{}\" (id SERIAL PRIMARY KEY, name TEXT)",
            table_name
        ))
        .await
        .unwrap();

    // Insert returns the inserted row in PostgreSQL with RETURNING
    let result = driver
        .execute_query(&format!(
            "INSERT INTO \"{}\" (name) VALUES ('Test') RETURNING *",
            table_name
        ))
        .await;
    assert!(result.is_ok());

    let query_result = result.unwrap();
    assert!(query_result.error.is_none(), "INSERT should succeed");
    assert_eq!(query_result.row_count, 1);

    // Cleanup
    drop_table(&driver, &table_name).await;
}

#[tokio::test]
async fn test_execute_query_update() {
    let driver = create_test_driver();
    let table_name = test_table_name("update");

    // Create table with data
    driver
        .execute_query(&format!(
            "CREATE TABLE \"{}\" (id SERIAL PRIMARY KEY, name TEXT, age INTEGER)",
            table_name
        ))
        .await
        .unwrap();

    driver
        .execute_query(&format!(
            "INSERT INTO \"{}\" (name, age) VALUES ('Test', 25)",
            table_name
        ))
        .await
        .unwrap();

    // Update with RETURNING
    let result = driver
        .execute_query(&format!(
            "UPDATE \"{}\" SET age = 30 WHERE name = 'Test' RETURNING *",
            table_name
        ))
        .await;
    assert!(result.is_ok());
    assert!(result.unwrap().error.is_none());

    // Verify update
    let select_result = driver
        .execute_query(&format!(
            "SELECT age FROM \"{}\" WHERE name = 'Test'",
            table_name
        ))
        .await
        .unwrap();
    let age = select_result.data[0].get("age").unwrap().as_i64().unwrap();
    assert_eq!(age, 30);

    // Cleanup
    drop_table(&driver, &table_name).await;
}

#[tokio::test]
async fn test_execute_query_delete() {
    let driver = create_test_driver();
    let table_name = test_table_name("delete");

    // Create table with data
    driver
        .execute_query(&format!(
            "CREATE TABLE \"{}\" (id SERIAL PRIMARY KEY, name TEXT)",
            table_name
        ))
        .await
        .unwrap();

    driver
        .execute_query(&format!(
            "INSERT INTO \"{}\" (name) VALUES ('Test')",
            table_name
        ))
        .await
        .unwrap();

    // Delete with RETURNING
    let result = driver
        .execute_query(&format!(
            "DELETE FROM \"{}\" WHERE name = 'Test' RETURNING *",
            table_name
        ))
        .await;
    assert!(result.is_ok());
    assert!(result.unwrap().error.is_none());

    // Verify delete
    let select_result = driver
        .execute_query(&format!("SELECT * FROM \"{}\"", table_name))
        .await
        .unwrap();
    assert_eq!(select_result.row_count, 0);

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
            "CREATE TABLE \"{}\" (
                id SERIAL PRIMARY KEY,
                name TEXT NOT NULL
            )",
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
    assert_eq!(test_table.schema, "public");
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

    // Create table with various PostgreSQL types
    driver
        .execute_query(&format!(
            "CREATE TABLE \"{}\" (
                int2_col SMALLINT,
                int4_col INTEGER,
                int8_col BIGINT,
                float4_col REAL,
                float8_col DOUBLE PRECISION,
                numeric_col NUMERIC(10,2),
                text_col TEXT,
                varchar_col VARCHAR(255),
                bool_col BOOLEAN,
                date_col DATE,
                timestamp_col TIMESTAMP,
                json_col JSONB,
                uuid_col UUID
            )",
            table_name
        ))
        .await
        .unwrap();

    driver
        .execute_query(&format!(
            "INSERT INTO \"{}\" VALUES (
                1, 2, 3, 1.5, 2.5, 100.50, 'hello', 'world', true,
                '2024-01-01', '2024-01-01 12:00:00', '{{\"key\": \"value\"}}',
                'a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11'
            )",
            table_name
        ))
        .await
        .unwrap();

    let result = driver
        .execute_query(&format!("SELECT * FROM \"{}\"", table_name))
        .await
        .unwrap();

    assert_eq!(result.row_count, 1);
    let row = &result.data[0];

    // Verify data types are properly returned
    assert!(row.get("int2_col").is_some());
    assert!(row.get("int4_col").is_some());
    assert!(row.get("int8_col").is_some());
    assert!(row.get("float4_col").is_some());
    assert!(row.get("float8_col").is_some());
    assert!(row.get("text_col").is_some());
    assert!(row.get("bool_col").is_some());
    assert!(row.get("date_col").is_some());
    assert!(row.get("json_col").is_some());
    assert!(row.get("uuid_col").is_some());

    // Cleanup
    drop_table(&driver, &table_name).await;
}

// ============================================================================
// Update/Delete Isolation Tests
// ============================================================================

#[tokio::test]
async fn test_update_only_affects_targeted_row() {
    let driver = create_test_driver();
    let table_name = test_table_name("upd_iso");

    // Create table
    driver
        .execute_query(&format!(
            "CREATE TABLE \"{}\" (id SERIAL PRIMARY KEY, name TEXT, age INTEGER)",
            table_name
        ))
        .await
        .unwrap();

    // Insert test data
    driver
        .execute_query(&format!(
            "INSERT INTO \"{}\" (name, age) VALUES ('Alice', 30), ('Bob', 25), ('Charlie', 35)",
            table_name
        ))
        .await
        .unwrap();

    // Update only Bob's age
    driver
        .execute_query(&format!(
            "UPDATE \"{}\" SET age = 99 WHERE name = 'Bob'",
            table_name
        ))
        .await
        .expect("Update should succeed");

    // Verify Bob was updated
    let bob = driver
        .execute_query(&format!(
            "SELECT age FROM \"{}\" WHERE name = 'Bob'",
            table_name
        ))
        .await
        .unwrap();
    assert_eq!(bob.data[0].get("age").unwrap().as_i64().unwrap(), 99);

    // Verify Alice was NOT affected
    let alice = driver
        .execute_query(&format!(
            "SELECT age FROM \"{}\" WHERE name = 'Alice'",
            table_name
        ))
        .await
        .unwrap();
    assert_eq!(
        alice.data[0].get("age").unwrap().as_i64().unwrap(),
        30,
        "Alice's age should remain unchanged"
    );

    // Verify Charlie was NOT affected
    let charlie = driver
        .execute_query(&format!(
            "SELECT age FROM \"{}\" WHERE name = 'Charlie'",
            table_name
        ))
        .await
        .unwrap();
    assert_eq!(
        charlie.data[0].get("age").unwrap().as_i64().unwrap(),
        35,
        "Charlie's age should remain unchanged"
    );

    // Cleanup
    drop_table(&driver, &table_name).await;
}

#[tokio::test]
async fn test_delete_only_affects_targeted_row() {
    let driver = create_test_driver();
    let table_name = test_table_name("del_iso");

    // Create table
    driver
        .execute_query(&format!(
            "CREATE TABLE \"{}\" (id SERIAL PRIMARY KEY, name TEXT)",
            table_name
        ))
        .await
        .unwrap();

    // Insert test data
    driver
        .execute_query(&format!(
            "INSERT INTO \"{}\" (name) VALUES ('Alice'), ('Bob'), ('Charlie')",
            table_name
        ))
        .await
        .unwrap();

    // Delete only Bob
    driver
        .execute_query(&format!(
            "DELETE FROM \"{}\" WHERE name = 'Bob'",
            table_name
        ))
        .await
        .expect("Delete should succeed");

    // Verify Bob was deleted
    let bob = driver
        .execute_query(&format!(
            "SELECT * FROM \"{}\" WHERE name = 'Bob'",
            table_name
        ))
        .await
        .unwrap();
    assert_eq!(bob.row_count, 0, "Bob should be deleted");

    // Verify Alice still exists
    let alice = driver
        .execute_query(&format!(
            "SELECT * FROM \"{}\" WHERE name = 'Alice'",
            table_name
        ))
        .await
        .unwrap();
    assert_eq!(alice.row_count, 1, "Alice should still exist");

    // Verify Charlie still exists
    let charlie = driver
        .execute_query(&format!(
            "SELECT * FROM \"{}\" WHERE name = 'Charlie'",
            table_name
        ))
        .await
        .unwrap();
    assert_eq!(charlie.row_count, 1, "Charlie should still exist");

    // Cleanup
    drop_table(&driver, &table_name).await;
}

#[tokio::test]
async fn test_update_does_not_affect_other_tables() {
    let driver = create_test_driver();
    let users_table = test_table_name("users");
    let admins_table = test_table_name("admins");

    // Create two tables with same structure
    driver
        .execute_query(&format!(
            "CREATE TABLE \"{}\" (id SERIAL PRIMARY KEY, name TEXT, age INTEGER)",
            users_table
        ))
        .await
        .unwrap();

    driver
        .execute_query(&format!(
            "CREATE TABLE \"{}\" (id SERIAL PRIMARY KEY, name TEXT, age INTEGER)",
            admins_table
        ))
        .await
        .unwrap();

    // Insert same data into both
    driver
        .execute_query(&format!(
            "INSERT INTO \"{}\" (name, age) VALUES ('Alice', 30)",
            users_table
        ))
        .await
        .unwrap();

    driver
        .execute_query(&format!(
            "INSERT INTO \"{}\" (name, age) VALUES ('Alice', 30)",
            admins_table
        ))
        .await
        .unwrap();

    // Update only users table
    driver
        .execute_query(&format!(
            "UPDATE \"{}\" SET age = 50 WHERE name = 'Alice'",
            users_table
        ))
        .await
        .unwrap();

    // Verify users table updated
    let user = driver
        .execute_query(&format!(
            "SELECT age FROM \"{}\" WHERE name = 'Alice'",
            users_table
        ))
        .await
        .unwrap();
    assert_eq!(user.data[0].get("age").unwrap().as_i64().unwrap(), 50);

    // Verify admins table NOT affected
    let admin = driver
        .execute_query(&format!(
            "SELECT age FROM \"{}\" WHERE name = 'Alice'",
            admins_table
        ))
        .await
        .unwrap();
    assert_eq!(
        admin.data[0].get("age").unwrap().as_i64().unwrap(),
        30,
        "Admins table should NOT be affected"
    );

    // Cleanup
    drop_table(&driver, &users_table).await;
    drop_table(&driver, &admins_table).await;
}
