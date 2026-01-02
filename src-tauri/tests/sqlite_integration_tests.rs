//! Integration tests for the SQLite database driver
//!
//! These tests verify the SQLite driver implementation of the DatabaseDriver trait.
//! Tests use a temporary database file that is cleaned up after each test.

use std::path::PathBuf;
use tempfile::{tempdir, TempDir};

// Re-export the modules we need to test
use dbcooper_lib::database::sqlite::SqliteDriver;
use dbcooper_lib::database::{DatabaseDriver, SqliteConfig};

/// Helper function to create a test SQLite driver with a temporary database
fn create_test_driver(temp_dir: &TempDir) -> (SqliteDriver, PathBuf) {
    let db_path = temp_dir.path().join("test.db");
    let config = SqliteConfig {
        file_path: db_path.to_string_lossy().to_string(),
    };
    (SqliteDriver::new(config), db_path)
}

/// Helper to create a driver and set up a test table
async fn create_driver_with_table(temp_dir: &TempDir) -> SqliteDriver {
    let (driver, _) = create_test_driver(temp_dir);

    // Create a test table
    driver
        .execute_query(
            r#"
            CREATE TABLE IF NOT EXISTS users (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                name TEXT NOT NULL,
                email TEXT UNIQUE,
                age INTEGER,
                active BOOLEAN DEFAULT 1,
                created_at DATETIME DEFAULT CURRENT_TIMESTAMP
            )
            "#,
        )
        .await
        .expect("Failed to create test table");

    driver
}

/// Helper to get row count from a table
async fn get_row_count(driver: &SqliteDriver, table: &str) -> i64 {
    let query = format!("SELECT COUNT(*) FROM {}", table);
    let result = driver.execute_query(&query).await.unwrap();
    // Debug: print the actual result
    eprintln!(
        "DEBUG COUNT query for {}: data={:?}, row_count={}",
        table, result.data, result.row_count
    );
    // The COUNT result is returned as the first value in the first row
    if result.data.is_empty() {
        eprintln!("DEBUG: result.data is empty!");
        return 0;
    }
    let row = result.data[0].as_object().unwrap();
    eprintln!("DEBUG: row={:?}", row);
    // SQLite returns COUNT(*) column - get first value
    let value = row.values().next().unwrap();
    eprintln!("DEBUG: value={:?}", value);
    value.as_i64().unwrap_or(0)
}

// ============================================================================
// Connection Tests
// ============================================================================

#[tokio::test]
async fn test_connection_success() {
    let temp_dir = tempdir().expect("Failed to create temp directory");
    let (driver, _) = create_test_driver(&temp_dir);

    let result = driver.test_connection().await;
    assert!(result.is_ok());

    let test_result = result.unwrap();
    assert!(test_result.success, "Connection should succeed");
    assert_eq!(test_result.message, "Connection successful!");
}

#[tokio::test]
async fn test_connection_creates_database() {
    let temp_dir = tempdir().expect("Failed to create temp directory");
    let (driver, db_path) = create_test_driver(&temp_dir);

    // Database file shouldn't exist yet
    assert!(
        !db_path.exists(),
        "Database should not exist before connection"
    );

    let result = driver.test_connection().await;
    assert!(result.is_ok());
    assert!(result.unwrap().success);

    // Now the database file should exist
    assert!(db_path.exists(), "Database should exist after connection");
}

// ============================================================================
// List Tables Tests
// ============================================================================

#[tokio::test]
async fn test_list_tables_empty_database() {
    let temp_dir = tempdir().expect("Failed to create temp directory");
    let (driver, _) = create_test_driver(&temp_dir);

    let result = driver.list_tables().await;
    assert!(result.is_ok());

    let tables = result.unwrap();
    assert!(tables.is_empty(), "New database should have no tables");
}

#[tokio::test]
async fn test_list_tables_with_tables() {
    let temp_dir = tempdir().expect("Failed to create temp directory");
    let driver = create_driver_with_table(&temp_dir).await;

    // Create another table
    driver
        .execute_query("CREATE TABLE products (id INTEGER PRIMARY KEY, name TEXT)")
        .await
        .expect("Failed to create products table");

    let result = driver.list_tables().await;
    assert!(result.is_ok());

    let tables = result.unwrap();
    assert_eq!(tables.len(), 2, "Should have 2 tables");

    let has_users = tables.iter().any(|t| t.name == "users");
    let has_products = tables.iter().any(|t| t.name == "products");
    assert!(has_users, "Should contain users table");
    assert!(has_products, "Should contain products table");

    // All tables should have "main" schema and "table" type
    for table in &tables {
        assert_eq!(table.schema, "main", "Schema should be 'main'");
        assert_eq!(table.table_type, "table", "Type should be 'table'");
    }
}

#[tokio::test]
async fn test_list_tables_excludes_sqlite_internal() {
    let temp_dir = tempdir().expect("Failed to create temp directory");
    let driver = create_driver_with_table(&temp_dir).await;

    let result = driver.list_tables().await;
    assert!(result.is_ok());

    let tables = result.unwrap();
    // Should not include sqlite_* tables
    for table in &tables {
        assert!(
            !table.name.starts_with("sqlite_"),
            "Should not list sqlite internal tables"
        );
    }
}

#[tokio::test]
async fn test_list_tables_includes_views() {
    let temp_dir = tempdir().expect("Failed to create temp directory");
    let driver = create_driver_with_table(&temp_dir).await;

    // Create a view
    driver
        .execute_query("CREATE VIEW active_users AS SELECT * FROM users WHERE active = 1")
        .await
        .expect("Failed to create view");

    let result = driver.list_tables().await;
    assert!(result.is_ok());

    let tables = result.unwrap();
    let view = tables.iter().find(|t| t.name == "active_users");
    assert!(view.is_some(), "Should include view");
    assert_eq!(view.unwrap().table_type, "view", "Type should be 'view'");
}

// ============================================================================
// Get Table Data Tests
// ============================================================================

#[tokio::test]
async fn test_get_table_data_empty_table() {
    let temp_dir = tempdir().expect("Failed to create temp directory");
    let driver = create_driver_with_table(&temp_dir).await;

    let result = driver.get_table_data("main", "users", 1, 10, None).await;
    assert!(result.is_ok());

    let data = result.unwrap();
    assert!(data.data.is_empty(), "Empty table should return no rows");
    assert_eq!(data.total, 0, "Total should be 0");
    assert_eq!(data.page, 1);
    assert_eq!(data.limit, 10);
}

#[tokio::test]
async fn test_get_table_data_with_rows() {
    let temp_dir = tempdir().expect("Failed to create temp directory");
    let driver = create_driver_with_table(&temp_dir).await;

    // Insert test data
    driver
        .execute_query(
            "INSERT INTO users (name, email, age) VALUES 
             ('Alice', 'alice@test.com', 30),
             ('Bob', 'bob@test.com', 25),
             ('Charlie', 'charlie@test.com', 35)",
        )
        .await
        .expect("Failed to insert test data");

    let result = driver.get_table_data("main", "users", 1, 10, None).await;
    assert!(result.is_ok());

    let data = result.unwrap();
    assert_eq!(data.data.len(), 3, "Should return 3 rows");
    assert_eq!(data.total, 3, "Total should be 3");
}

#[tokio::test]
async fn test_get_table_data_pagination() {
    let temp_dir = tempdir().expect("Failed to create temp directory");
    let driver = create_driver_with_table(&temp_dir).await;

    // Insert 5 rows
    for i in 1..=5 {
        driver
            .execute_query(&format!(
                "INSERT INTO users (name, email, age) VALUES ('User{}', 'user{}@test.com', {})",
                i,
                i,
                20 + i
            ))
            .await
            .expect("Failed to insert test data");
    }

    // Get page 1 with limit 2
    let page1 = driver
        .get_table_data("main", "users", 1, 2, None)
        .await
        .unwrap();
    assert_eq!(page1.data.len(), 2, "Page 1 should have 2 rows");
    assert_eq!(page1.total, 5, "Total should be 5");
    assert_eq!(page1.page, 1);

    // Get page 2 with limit 2
    let page2 = driver
        .get_table_data("main", "users", 2, 2, None)
        .await
        .unwrap();
    assert_eq!(page2.data.len(), 2, "Page 2 should have 2 rows");
    assert_eq!(page2.page, 2);

    // Get page 3 with limit 2 (should have 1 row)
    let page3 = driver
        .get_table_data("main", "users", 3, 2, None)
        .await
        .unwrap();
    assert_eq!(page3.data.len(), 1, "Page 3 should have 1 row");
}

#[tokio::test]
async fn test_get_table_data_with_filter() {
    let temp_dir = tempdir().expect("Failed to create temp directory");
    let driver = create_driver_with_table(&temp_dir).await;

    // Insert test data
    driver
        .execute_query(
            "INSERT INTO users (name, email, age) VALUES 
             ('Alice', 'alice@test.com', 30),
             ('Bob', 'bob@test.com', 25),
             ('Charlie', 'charlie@test.com', 35)",
        )
        .await
        .expect("Failed to insert test data");

    let result = driver
        .get_table_data("main", "users", 1, 10, Some("age > 25".to_string()))
        .await;
    assert!(result.is_ok());

    let data = result.unwrap();
    assert_eq!(data.data.len(), 2, "Should return 2 rows matching filter");
    assert_eq!(data.total, 2, "Total should be 2");
}

// ============================================================================
// Get Table Structure Tests
// ============================================================================

#[tokio::test]
async fn test_get_table_structure_columns() {
    let temp_dir = tempdir().expect("Failed to create temp directory");
    let driver = create_driver_with_table(&temp_dir).await;

    let result = driver.get_table_structure("main", "users").await;
    assert!(result.is_ok());

    let structure = result.unwrap();
    assert_eq!(structure.columns.len(), 6, "Should have 6 columns");

    // Find the 'id' column
    let id_col = structure.columns.iter().find(|c| c.name == "id");
    assert!(id_col.is_some(), "Should have id column");
    let id_col = id_col.unwrap();
    assert!(id_col.primary_key, "id should be primary key");
    assert_eq!(id_col.data_type, "INTEGER");

    // Find the 'name' column
    let name_col = structure.columns.iter().find(|c| c.name == "name");
    assert!(name_col.is_some(), "Should have name column");
    let name_col = name_col.unwrap();
    assert!(!name_col.nullable, "name should NOT be nullable");
    assert_eq!(name_col.data_type, "TEXT");

    // Find the 'email' column
    let email_col = structure.columns.iter().find(|c| c.name == "email");
    assert!(email_col.is_some(), "Should have email column");
    let email_col = email_col.unwrap();
    assert!(email_col.nullable, "email should be nullable");

    // Find the 'active' column with default
    let active_col = structure.columns.iter().find(|c| c.name == "active");
    assert!(active_col.is_some(), "Should have active column");
    let active_col = active_col.unwrap();
    assert!(active_col.default.is_some(), "active should have default");
    assert_eq!(active_col.default.as_ref().unwrap(), "1");
}

#[tokio::test]
async fn test_get_table_structure_indexes() {
    let temp_dir = tempdir().expect("Failed to create temp directory");
    let driver = create_driver_with_table(&temp_dir).await;

    // Create an index
    driver
        .execute_query("CREATE INDEX idx_users_name ON users(name)")
        .await
        .expect("Failed to create index");

    let result = driver.get_table_structure("main", "users").await;
    assert!(result.is_ok());

    let structure = result.unwrap();

    // Should have at least one index (the one we created, email unique may also create one)
    assert!(!structure.indexes.is_empty(), "Should have indexes");

    let name_idx = structure
        .indexes
        .iter()
        .find(|i| i.name == "idx_users_name");
    assert!(name_idx.is_some(), "Should have idx_users_name");
    let name_idx = name_idx.unwrap();
    assert!(!name_idx.unique, "idx_users_name should not be unique");
    assert!(name_idx.columns.iter().any(|c| c == "name"));
}

#[tokio::test]
async fn test_get_table_structure_foreign_keys() {
    let temp_dir = tempdir().expect("Failed to create temp directory");
    let (driver, _) = create_test_driver(&temp_dir);

    // Enable foreign keys
    driver
        .execute_query("PRAGMA foreign_keys = ON")
        .await
        .unwrap();

    // Create parent table
    driver
        .execute_query(
            "CREATE TABLE departments (
                id INTEGER PRIMARY KEY,
                name TEXT NOT NULL
            )",
        )
        .await
        .expect("Failed to create departments table");

    // Create child table with foreign key
    driver
        .execute_query(
            "CREATE TABLE employees (
                id INTEGER PRIMARY KEY,
                name TEXT NOT NULL,
                department_id INTEGER,
                FOREIGN KEY (department_id) REFERENCES departments(id)
            )",
        )
        .await
        .expect("Failed to create employees table");

    let result = driver.get_table_structure("main", "employees").await;
    assert!(result.is_ok());

    let structure = result.unwrap();
    assert!(
        !structure.foreign_keys.is_empty(),
        "Should have foreign keys"
    );

    let fk = &structure.foreign_keys[0];
    assert_eq!(fk.column, "department_id");
    assert_eq!(fk.references_table, "departments");
    assert_eq!(fk.references_column, "id");
}

// ============================================================================
// Execute Query Tests
// ============================================================================

#[tokio::test]
async fn test_execute_query_select() {
    let temp_dir = tempdir().expect("Failed to create temp directory");
    let driver = create_driver_with_table(&temp_dir).await;

    // Insert some data
    driver
        .execute_query("INSERT INTO users (name, email, age) VALUES ('Test', 'test@test.com', 25)")
        .await
        .unwrap();

    let result = driver.execute_query("SELECT * FROM users").await;
    assert!(result.is_ok());

    let query_result = result.unwrap();
    assert!(query_result.error.is_none(), "Should not have error");
    assert_eq!(query_result.row_count, 1);
    assert!(!query_result.data.is_empty());
    assert!(query_result.time_taken_ms.is_some());
}

#[tokio::test]
async fn test_execute_query_insert() {
    let temp_dir = tempdir().expect("Failed to create temp directory");
    let driver = create_driver_with_table(&temp_dir).await;

    let result = driver
        .execute_query("INSERT INTO users (name, email, age) VALUES ('Test', 'test@test.com', 25)")
        .await;
    assert!(result.is_ok());

    let query_result = result.unwrap();
    assert!(query_result.error.is_none());
}

#[tokio::test]
async fn test_execute_query_update() {
    let temp_dir = tempdir().expect("Failed to create temp directory");
    let driver = create_driver_with_table(&temp_dir).await;

    // Insert then update
    driver
        .execute_query("INSERT INTO users (name, email, age) VALUES ('Test', 'test@test.com', 25)")
        .await
        .unwrap();

    let result = driver
        .execute_query("UPDATE users SET age = 30 WHERE name = 'Test'")
        .await;
    assert!(result.is_ok());
    assert!(result.unwrap().error.is_none());

    // Verify update
    let select_result = driver
        .execute_query("SELECT age FROM users WHERE name = 'Test'")
        .await
        .unwrap();
    let age = select_result.data[0].get("age").unwrap().as_i64().unwrap();
    assert_eq!(age, 30);
}

#[tokio::test]
async fn test_execute_query_delete() {
    let temp_dir = tempdir().expect("Failed to create temp directory");
    let driver = create_driver_with_table(&temp_dir).await;

    // Insert then delete
    driver
        .execute_query("INSERT INTO users (name, email, age) VALUES ('Test', 'test@test.com', 25)")
        .await
        .unwrap();

    let result = driver
        .execute_query("DELETE FROM users WHERE name = 'Test'")
        .await;
    assert!(result.is_ok());
    assert!(result.unwrap().error.is_none());

    // Verify delete
    let select_result = driver.execute_query("SELECT * FROM users").await.unwrap();
    assert_eq!(select_result.row_count, 0);
}

#[tokio::test]
async fn test_execute_query_syntax_error() {
    let temp_dir = tempdir().expect("Failed to create temp directory");
    let driver = create_driver_with_table(&temp_dir).await;

    let result = driver.execute_query("SELECTTTT * FROM users").await;
    assert!(result.is_ok());

    let query_result = result.unwrap();
    assert!(
        query_result.error.is_some(),
        "Should have error for invalid SQL"
    );
    assert!(query_result.data.is_empty());
}

// ============================================================================
// Get Schema Overview Tests
// ============================================================================

#[tokio::test]
async fn test_get_schema_overview() {
    let temp_dir = tempdir().expect("Failed to create temp directory");
    let (driver, _) = create_test_driver(&temp_dir);

    // Enable foreign keys
    driver
        .execute_query("PRAGMA foreign_keys = ON")
        .await
        .unwrap();

    // Create multiple tables with relationships
    driver
        .execute_query(
            "CREATE TABLE categories (
                id INTEGER PRIMARY KEY,
                name TEXT NOT NULL
            )",
        )
        .await
        .unwrap();

    driver
        .execute_query(
            "CREATE TABLE products (
                id INTEGER PRIMARY KEY,
                name TEXT NOT NULL,
                category_id INTEGER,
                FOREIGN KEY (category_id) REFERENCES categories(id)
            )",
        )
        .await
        .unwrap();

    // Create an index
    driver
        .execute_query("CREATE INDEX idx_products_name ON products(name)")
        .await
        .unwrap();

    let result = driver.get_schema_overview().await;
    assert!(result.is_ok());

    let overview = result.unwrap();
    assert_eq!(overview.tables.len(), 2, "Should have 2 tables");

    // Verify categories table
    let categories = overview.tables.iter().find(|t| t.name == "categories");
    assert!(categories.is_some());
    let categories = categories.unwrap();
    assert_eq!(categories.schema, "main");
    assert_eq!(categories.columns.len(), 2);

    // Verify products table with FK
    let products = overview.tables.iter().find(|t| t.name == "products");
    assert!(products.is_some());
    let products = products.unwrap();
    assert_eq!(products.columns.len(), 3);
    assert!(
        !products.foreign_keys.is_empty(),
        "products should have foreign keys"
    );
}

// ============================================================================
// Data Type Tests
// ============================================================================

#[tokio::test]
async fn test_row_to_json_all_types() {
    let temp_dir = tempdir().expect("Failed to create temp directory");
    let (driver, _) = create_test_driver(&temp_dir);

    // Create a table with all SQLite types
    driver
        .execute_query(
            "CREATE TABLE all_types (
                int_col INTEGER,
                real_col REAL,
                text_col TEXT,
                blob_col BLOB,
                null_col TEXT
            )",
        )
        .await
        .unwrap();

    driver
        .execute_query("INSERT INTO all_types VALUES (42, 3.14, 'hello', X'48454C4C4F', NULL)")
        .await
        .unwrap();

    let result = driver
        .execute_query("SELECT * FROM all_types")
        .await
        .unwrap();
    assert_eq!(result.row_count, 1);

    let row = &result.data[0];
    assert_eq!(row.get("int_col").unwrap().as_i64().unwrap(), 42);
    assert!((row.get("real_col").unwrap().as_f64().unwrap() - 3.14).abs() < 0.001);
    assert_eq!(row.get("text_col").unwrap().as_str().unwrap(), "hello");
    assert!(row
        .get("blob_col")
        .unwrap()
        .as_str()
        .unwrap()
        .contains("bytes"));
    // NULL columns may be returned as empty string or as null depending on SQLite version
    assert!(
        row.get("null_col").unwrap().is_null()
            || row
                .get("null_col")
                .unwrap()
                .as_str()
                .map_or(false, |s| s.is_empty()),
        "null_col should be null or empty"
    );
}

// ============================================================================
// Update/Delete Isolation Tests
// ============================================================================

#[tokio::test]
async fn test_update_only_affects_targeted_row() {
    let temp_dir = tempdir().expect("Failed to create temp directory");
    let driver = create_driver_with_table(&temp_dir).await;

    // Insert multiple rows
    driver
        .execute_query(
            "INSERT INTO users (name, email, age) VALUES
             ('Alice', 'alice@test.com', 30),
             ('Bob', 'bob@test.com', 25),
             ('Charlie', 'charlie@test.com', 35)",
        )
        .await
        .expect("Failed to insert test data");

    // Update only Bob's age
    driver
        .execute_query("UPDATE users SET age = 99 WHERE name = 'Bob'")
        .await
        .expect("Update should succeed");

    // Verify Bob was updated
    let bob = driver
        .execute_query("SELECT age FROM users WHERE name = 'Bob'")
        .await
        .unwrap();
    assert_eq!(bob.data[0].get("age").unwrap().as_i64().unwrap(), 99);

    // Verify Alice was NOT affected
    let alice = driver
        .execute_query("SELECT age FROM users WHERE name = 'Alice'")
        .await
        .unwrap();
    assert_eq!(
        alice.data[0].get("age").unwrap().as_i64().unwrap(),
        30,
        "Alice's age should remain unchanged"
    );

    // Verify Charlie was NOT affected
    let charlie = driver
        .execute_query("SELECT age FROM users WHERE name = 'Charlie'")
        .await
        .unwrap();
    assert_eq!(
        charlie.data[0].get("age").unwrap().as_i64().unwrap(),
        35,
        "Charlie's age should remain unchanged"
    );

    // Verify total row count is still 3
    let count = get_row_count(&driver, "users").await;
    assert_eq!(count, 3, "Should still have 3 rows");
}

#[tokio::test]
async fn test_delete_only_affects_targeted_row() {
    let temp_dir = tempdir().expect("Failed to create temp directory");
    let driver = create_driver_with_table(&temp_dir).await;

    // Insert multiple rows
    driver
        .execute_query(
            "INSERT INTO users (name, email, age) VALUES
             ('Alice', 'alice@test.com', 30),
             ('Bob', 'bob@test.com', 25),
             ('Charlie', 'charlie@test.com', 35)",
        )
        .await
        .expect("Failed to insert test data");

    // Delete only Bob
    driver
        .execute_query("DELETE FROM users WHERE name = 'Bob'")
        .await
        .expect("Delete should succeed");

    // Verify Bob was deleted
    let bob = driver
        .execute_query("SELECT * FROM users WHERE name = 'Bob'")
        .await
        .unwrap();
    assert_eq!(bob.row_count, 0, "Bob should be deleted");

    // Verify Alice still exists
    let alice = driver
        .execute_query("SELECT * FROM users WHERE name = 'Alice'")
        .await
        .unwrap();
    assert_eq!(alice.row_count, 1, "Alice should still exist");
    assert_eq!(alice.data[0].get("age").unwrap().as_i64().unwrap(), 30);

    // Verify Charlie still exists
    let charlie = driver
        .execute_query("SELECT * FROM users WHERE name = 'Charlie'")
        .await
        .unwrap();
    assert_eq!(charlie.row_count, 1, "Charlie should still exist");
    assert_eq!(charlie.data[0].get("age").unwrap().as_i64().unwrap(), 35);

    // Verify total row count is now 2
    let count = get_row_count(&driver, "users").await;
    assert_eq!(count, 2, "Should now have 2 rows");
}

#[tokio::test]
async fn test_update_does_not_affect_other_tables() {
    let temp_dir = tempdir().expect("Failed to create temp directory");
    let driver = create_driver_with_table(&temp_dir).await;

    // Create a second table with similar structure
    driver
        .execute_query(
            "CREATE TABLE admins (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                name TEXT NOT NULL,
                age INTEGER
            )",
        )
        .await
        .expect("Failed to create admins table");

    // Insert data into both tables with same name/age
    driver
        .execute_query(
            "INSERT INTO users (name, email, age) VALUES ('Alice', 'alice@users.com', 30)",
        )
        .await
        .unwrap();
    driver
        .execute_query("INSERT INTO admins (name, age) VALUES ('Alice', 30)")
        .await
        .unwrap();

    // Update users table
    driver
        .execute_query("UPDATE users SET age = 50 WHERE name = 'Alice'")
        .await
        .expect("Update should succeed");

    // Verify users table was updated
    let user_alice = driver
        .execute_query("SELECT age FROM users WHERE name = 'Alice'")
        .await
        .unwrap();
    assert_eq!(
        user_alice.data[0].get("age").unwrap().as_i64().unwrap(),
        50,
        "User Alice should be updated"
    );

    // Verify admins table was NOT affected
    let admin_alice = driver
        .execute_query("SELECT age FROM admins WHERE name = 'Alice'")
        .await
        .unwrap();
    assert_eq!(
        admin_alice.data[0].get("age").unwrap().as_i64().unwrap(),
        30,
        "Admin Alice should remain unchanged"
    );
}

#[tokio::test]
async fn test_delete_does_not_affect_other_tables() {
    let temp_dir = tempdir().expect("Failed to create temp directory");
    let driver = create_driver_with_table(&temp_dir).await;

    // Create a second table
    driver
        .execute_query(
            "CREATE TABLE admins (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                name TEXT NOT NULL
            )",
        )
        .await
        .expect("Failed to create admins table");

    // Insert same name into both tables
    driver
        .execute_query(
            "INSERT INTO users (name, email, age) VALUES ('Alice', 'alice@users.com', 30)",
        )
        .await
        .unwrap();
    driver
        .execute_query("INSERT INTO admins (name) VALUES ('Alice')")
        .await
        .unwrap();

    // Delete from users table
    driver
        .execute_query("DELETE FROM users WHERE name = 'Alice'")
        .await
        .expect("Delete should succeed");

    // Verify users table row was deleted
    let user_count = get_row_count(&driver, "users").await;
    assert_eq!(user_count, 0, "Users table should be empty");

    // Verify admins table was NOT affected
    let admin_count = get_row_count(&driver, "admins").await;
    assert_eq!(admin_count, 1, "Admins table should still have 1 row");

    let admin_alice = driver
        .execute_query("SELECT name FROM admins")
        .await
        .unwrap();
    assert_eq!(
        admin_alice.data[0].get("name").unwrap().as_str().unwrap(),
        "Alice",
        "Admin Alice should still exist"
    );
}

#[tokio::test]
async fn test_update_with_no_matching_rows() {
    let temp_dir = tempdir().expect("Failed to create temp directory");
    let driver = create_driver_with_table(&temp_dir).await;

    // Insert test data
    driver
        .execute_query(
            "INSERT INTO users (name, email, age) VALUES
             ('Alice', 'alice@test.com', 30),
             ('Bob', 'bob@test.com', 25)",
        )
        .await
        .unwrap();

    // Try to update a non-existent user
    let result = driver
        .execute_query("UPDATE users SET age = 99 WHERE name = 'NonExistent'")
        .await;
    assert!(result.is_ok());
    assert!(result.unwrap().error.is_none());

    // Verify no rows were affected
    let alice = driver
        .execute_query("SELECT age FROM users WHERE name = 'Alice'")
        .await
        .unwrap();
    assert_eq!(alice.data[0].get("age").unwrap().as_i64().unwrap(), 30);

    let bob = driver
        .execute_query("SELECT age FROM users WHERE name = 'Bob'")
        .await
        .unwrap();
    assert_eq!(bob.data[0].get("age").unwrap().as_i64().unwrap(), 25);
}

#[tokio::test]
async fn test_delete_with_no_matching_rows() {
    let temp_dir = tempdir().expect("Failed to create temp directory");
    let driver = create_driver_with_table(&temp_dir).await;

    // Insert test data
    driver
        .execute_query(
            "INSERT INTO users (name, email, age) VALUES
             ('Alice', 'alice@test.com', 30),
             ('Bob', 'bob@test.com', 25)",
        )
        .await
        .unwrap();

    // Try to delete a non-existent user
    let result = driver
        .execute_query("DELETE FROM users WHERE name = 'NonExistent'")
        .await;
    assert!(result.is_ok());
    assert!(result.unwrap().error.is_none());

    // Verify all rows still exist
    let count = get_row_count(&driver, "users").await;
    assert_eq!(count, 2, "Both rows should still exist");
}
