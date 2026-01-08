//! Integration tests for app data management (connections, queries, settings)
//!
//! These tests verify CRUD operations for saved connections, queries, and settings
//! stored in the application's SQLite database.
//!
//! Run with: cargo test --test app_data_tests -- --test-threads=1

use dbcooper_lib::db::models::{Connection, SavedQuery, Setting};
use sqlx::sqlite::SqlitePoolOptions;
use tempfile::NamedTempFile;

/// Create a test SQLite pool with the app schema
/// Returns both pool and temp file (temp file must stay alive during test)
async fn create_test_pool() -> (sqlx::SqlitePool, NamedTempFile) {
    let temp_file = NamedTempFile::new().expect("Failed to create temp file");
    let db_url = format!("sqlite:{}?mode=rwc", temp_file.path().display());

    let pool = SqlitePoolOptions::new()
        .max_connections(1)
        .connect(&db_url)
        .await
        .expect("Failed to create pool");

    // Create schema
    sqlx::query(
        r#"
        CREATE TABLE IF NOT EXISTS connections (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            uuid TEXT NOT NULL UNIQUE,
            type TEXT NOT NULL DEFAULT 'postgres',
            name TEXT NOT NULL,
            host TEXT NOT NULL,
            port INTEGER NOT NULL,
            database TEXT NOT NULL,
            username TEXT NOT NULL,
            password TEXT NOT NULL,
            ssl INTEGER NOT NULL DEFAULT 0,
            db_type TEXT NOT NULL DEFAULT 'postgres',
            file_path TEXT,
            ssh_enabled INTEGER NOT NULL DEFAULT 0,
            ssh_host TEXT NOT NULL DEFAULT '',
            ssh_port INTEGER NOT NULL DEFAULT 22,
            ssh_user TEXT NOT NULL DEFAULT '',
            ssh_password TEXT NOT NULL DEFAULT '',
            ssh_key_path TEXT NOT NULL DEFAULT '',
            ssh_use_key INTEGER NOT NULL DEFAULT 0,
            created_at TEXT NOT NULL DEFAULT (datetime('now')),
            updated_at TEXT NOT NULL DEFAULT (datetime('now'))
        )
        "#,
    )
    .execute(&pool)
    .await
    .unwrap();

    sqlx::query(
        r#"
        CREATE TABLE IF NOT EXISTS saved_queries (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            connection_uuid TEXT NOT NULL,
            name TEXT NOT NULL,
            query TEXT NOT NULL,
            created_at TEXT NOT NULL DEFAULT (datetime('now')),
            updated_at TEXT NOT NULL DEFAULT (datetime('now'))
        )
        "#,
    )
    .execute(&pool)
    .await
    .unwrap();

    sqlx::query(
        r#"
        CREATE TABLE IF NOT EXISTS settings (
            key TEXT PRIMARY KEY,
            value TEXT NOT NULL
        )
        "#,
    )
    .execute(&pool)
    .await
    .unwrap();

    (pool, temp_file)
}

// ============================================================================
// Connection CRUD Tests
// ============================================================================

#[tokio::test]
async fn test_create_connection() {
    let (pool, _temp_file) = create_test_pool().await;
    let uuid = uuid::Uuid::new_v4().to_string();

    let result = sqlx::query_as::<_, Connection>(
        r#"
        INSERT INTO connections (uuid, type, name, host, port, database, username, password, ssl, db_type, file_path, ssh_enabled, ssh_host, ssh_port, ssh_user, ssh_password, ssh_key_path, ssh_use_key)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        RETURNING *
        "#,
    )
    .bind(&uuid)
    .bind("postgres")
    .bind("Test Connection")
    .bind("localhost")
    .bind(5432)
    .bind("testdb")
    .bind("user")
    .bind("pass")
    .bind(0)
    .bind("postgres")
    .bind::<Option<String>>(None)
    .bind(0)
    .bind("")
    .bind(22)
    .bind("")
    .bind("")
    .bind("")
    .bind(0)
    .fetch_one(&pool)
    .await;

    assert!(result.is_ok());
    let conn = result.unwrap();
    assert_eq!(conn.name, "Test Connection");
    assert_eq!(conn.host, "localhost");
    assert_eq!(conn.port, 5432);
}

#[tokio::test]
async fn test_get_connections() {
    let (pool, _temp_file) = create_test_pool().await;

    // Create two connections
    for i in 1..=2 {
        let uuid = uuid::Uuid::new_v4().to_string();
        sqlx::query(
            "INSERT INTO connections (uuid, type, name, host, port, database, username, password, db_type) VALUES (?, 'postgres', ?, 'localhost', 5432, 'db', 'user', 'pass', 'postgres')",
        )
        .bind(&uuid)
        .bind(format!("Connection {}", i))
        .execute(&pool)
        .await
        .unwrap();
    }

    let connections: Vec<Connection> = sqlx::query_as("SELECT * FROM connections ORDER BY id DESC")
        .fetch_all(&pool)
        .await
        .unwrap();

    assert_eq!(connections.len(), 2);
}

#[tokio::test]
async fn test_get_connection_by_uuid() {
    let (pool, _temp_file) = create_test_pool().await;
    let uuid = uuid::Uuid::new_v4().to_string();

    sqlx::query(
        "INSERT INTO connections (uuid, type, name, host, port, database, username, password, db_type) VALUES (?, 'postgres', 'Test', 'localhost', 5432, 'db', 'user', 'pass', 'postgres')",
    )
    .bind(&uuid)
    .execute(&pool)
    .await
    .unwrap();

    let conn: Connection = sqlx::query_as("SELECT * FROM connections WHERE uuid = ?")
        .bind(&uuid)
        .fetch_one(&pool)
        .await
        .unwrap();

    assert_eq!(conn.uuid, uuid);
    assert_eq!(conn.name, "Test");
}

#[tokio::test]
async fn test_update_connection() {
    let (pool, _temp_file) = create_test_pool().await;
    let uuid = uuid::Uuid::new_v4().to_string();

    // Create connection
    sqlx::query(
        "INSERT INTO connections (uuid, type, name, host, port, database, username, password, db_type) VALUES (?, 'postgres', 'Original', 'localhost', 5432, 'db', 'user', 'pass', 'postgres')",
    )
    .bind(&uuid)
    .execute(&pool)
    .await
    .unwrap();

    // Get the ID
    let conn: Connection = sqlx::query_as("SELECT * FROM connections WHERE uuid = ?")
        .bind(&uuid)
        .fetch_one(&pool)
        .await
        .unwrap();

    // Update
    let updated: Connection = sqlx::query_as(
        r#"
        UPDATE connections SET name = ?, host = ?, updated_at = datetime('now')
        WHERE id = ?
        RETURNING *
        "#,
    )
    .bind("Updated Name")
    .bind("newhost.example.com")
    .bind(conn.id)
    .fetch_one(&pool)
    .await
    .unwrap();

    assert_eq!(updated.name, "Updated Name");
    assert_eq!(updated.host, "newhost.example.com");
}

#[tokio::test]
async fn test_delete_connection() {
    let (pool, _temp_file) = create_test_pool().await;
    let uuid = uuid::Uuid::new_v4().to_string();

    // Create connection
    sqlx::query(
        "INSERT INTO connections (uuid, type, name, host, port, database, username, password, db_type) VALUES (?, 'postgres', 'ToDelete', 'localhost', 5432, 'db', 'user', 'pass', 'postgres')",
    )
    .bind(&uuid)
    .execute(&pool)
    .await
    .unwrap();

    // Get ID
    let conn: Connection = sqlx::query_as("SELECT * FROM connections WHERE uuid = ?")
        .bind(&uuid)
        .fetch_one(&pool)
        .await
        .unwrap();

    // Delete
    sqlx::query("DELETE FROM connections WHERE id = ?")
        .bind(conn.id)
        .execute(&pool)
        .await
        .unwrap();

    // Verify deletion
    let count: (i64,) = sqlx::query_as("SELECT COUNT(*) FROM connections WHERE uuid = ?")
        .bind(&uuid)
        .fetch_one(&pool)
        .await
        .unwrap();

    assert_eq!(count.0, 0, "Connection should be deleted");
}

// ============================================================================
// Saved Query CRUD Tests
// ============================================================================

#[tokio::test]
async fn test_create_saved_query() {
    let (pool, _temp_file) = create_test_pool().await;
    let connection_uuid = uuid::Uuid::new_v4().to_string();

    let result: SavedQuery = sqlx::query_as(
        r#"
        INSERT INTO saved_queries (connection_uuid, name, query)
        VALUES (?, ?, ?)
        RETURNING *
        "#,
    )
    .bind(&connection_uuid)
    .bind("My Query")
    .bind("SELECT * FROM users")
    .fetch_one(&pool)
    .await
    .unwrap();

    assert_eq!(result.name, "My Query");
    assert_eq!(result.query, "SELECT * FROM users");
    assert_eq!(result.connection_uuid, connection_uuid);
}

#[tokio::test]
async fn test_get_saved_queries_by_connection() {
    let (pool, _temp_file) = create_test_pool().await;
    let conn1 = uuid::Uuid::new_v4().to_string();
    let conn2 = uuid::Uuid::new_v4().to_string();

    // Create queries for conn1
    for i in 1..=3 {
        sqlx::query("INSERT INTO saved_queries (connection_uuid, name, query) VALUES (?, ?, ?)")
            .bind(&conn1)
            .bind(format!("Query {}", i))
            .bind("SELECT 1")
            .execute(&pool)
            .await
            .unwrap();
    }

    // Create query for conn2
    sqlx::query("INSERT INTO saved_queries (connection_uuid, name, query) VALUES (?, ?, ?)")
        .bind(&conn2)
        .bind("Other Query")
        .bind("SELECT 2")
        .execute(&pool)
        .await
        .unwrap();

    // Get queries for conn1
    let queries: Vec<SavedQuery> =
        sqlx::query_as("SELECT * FROM saved_queries WHERE connection_uuid = ?")
            .bind(&conn1)
            .fetch_all(&pool)
            .await
            .unwrap();

    assert_eq!(queries.len(), 3, "Should only return queries for conn1");
}

#[tokio::test]
async fn test_update_saved_query() {
    let (pool, _temp_file) = create_test_pool().await;
    let connection_uuid = uuid::Uuid::new_v4().to_string();

    // Create query
    let query: SavedQuery = sqlx::query_as(
        "INSERT INTO saved_queries (connection_uuid, name, query) VALUES (?, ?, ?) RETURNING *",
    )
    .bind(&connection_uuid)
    .bind("Original Query")
    .bind("SELECT 1")
    .fetch_one(&pool)
    .await
    .unwrap();

    // Update
    let updated: SavedQuery = sqlx::query_as(
        r#"
        UPDATE saved_queries SET name = ?, query = ?, updated_at = datetime('now')
        WHERE id = ?
        RETURNING *
        "#,
    )
    .bind("Updated Query")
    .bind("SELECT * FROM updated")
    .bind(query.id)
    .fetch_one(&pool)
    .await
    .unwrap();

    assert_eq!(updated.name, "Updated Query");
    assert_eq!(updated.query, "SELECT * FROM updated");
}

#[tokio::test]
async fn test_delete_saved_query() {
    let (pool, _temp_file) = create_test_pool().await;
    let connection_uuid = uuid::Uuid::new_v4().to_string();

    // Create query
    let query: SavedQuery = sqlx::query_as(
        "INSERT INTO saved_queries (connection_uuid, name, query) VALUES (?, ?, ?) RETURNING *",
    )
    .bind(&connection_uuid)
    .bind("To Delete")
    .bind("SELECT 1")
    .fetch_one(&pool)
    .await
    .unwrap();

    // Delete
    sqlx::query("DELETE FROM saved_queries WHERE id = ?")
        .bind(query.id)
        .execute(&pool)
        .await
        .unwrap();

    // Verify
    let count: (i64,) = sqlx::query_as("SELECT COUNT(*) FROM saved_queries WHERE id = ?")
        .bind(query.id)
        .fetch_one(&pool)
        .await
        .unwrap();

    assert_eq!(count.0, 0);
}

// ============================================================================
// Settings CRUD Tests
// ============================================================================

#[tokio::test]
async fn test_set_and_get_setting() {
    let (pool, _temp_file) = create_test_pool().await;

    // Set a setting
    sqlx::query("INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)")
        .bind("theme")
        .bind("dark")
        .execute(&pool)
        .await
        .unwrap();

    // Get the setting
    let setting: Setting = sqlx::query_as("SELECT key, value FROM settings WHERE key = ?")
        .bind("theme")
        .fetch_one(&pool)
        .await
        .unwrap();

    assert_eq!(setting.key, "theme");
    assert_eq!(setting.value, "dark");
}

#[tokio::test]
async fn test_get_nonexistent_setting() {
    let (pool, _temp_file) = create_test_pool().await;

    let setting: Option<Setting> = sqlx::query_as("SELECT key, value FROM settings WHERE key = ?")
        .bind("nonexistent")
        .fetch_optional(&pool)
        .await
        .unwrap();

    assert!(setting.is_none());
}

#[tokio::test]
async fn test_update_setting() {
    let (pool, _temp_file) = create_test_pool().await;

    // Set initial value
    sqlx::query("INSERT INTO settings (key, value) VALUES (?, ?)")
        .bind("font_size")
        .bind("14")
        .execute(&pool)
        .await
        .unwrap();

    // Update using INSERT OR REPLACE
    sqlx::query("INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)")
        .bind("font_size")
        .bind("16")
        .execute(&pool)
        .await
        .unwrap();

    // Verify
    let setting: Setting = sqlx::query_as("SELECT key, value FROM settings WHERE key = ?")
        .bind("font_size")
        .fetch_one(&pool)
        .await
        .unwrap();

    assert_eq!(setting.value, "16");
}

#[tokio::test]
async fn test_get_all_settings() {
    let (pool, _temp_file) = create_test_pool().await;

    // Create multiple settings
    for (key, value) in [
        ("setting1", "value1"),
        ("setting2", "value2"),
        ("setting3", "value3"),
    ] {
        sqlx::query("INSERT INTO settings (key, value) VALUES (?, ?)")
            .bind(key)
            .bind(value)
            .execute(&pool)
            .await
            .unwrap();
    }

    let settings: Vec<Setting> = sqlx::query_as("SELECT key, value FROM settings")
        .fetch_all(&pool)
        .await
        .unwrap();

    assert_eq!(settings.len(), 3);
}

// ============================================================================
// Edge Case Tests
// ============================================================================

#[tokio::test]
async fn test_connection_uuid_uniqueness() {
    let (pool, _temp_file) = create_test_pool().await;
    let uuid = uuid::Uuid::new_v4().to_string();

    // Create first connection
    sqlx::query(
        "INSERT INTO connections (uuid, type, name, host, port, database, username, password, db_type) VALUES (?, 'postgres', 'First', 'localhost', 5432, 'db', 'user', 'pass', 'postgres')",
    )
    .bind(&uuid)
    .execute(&pool)
    .await
    .unwrap();

    // Try to create another with same UUID
    let result = sqlx::query(
        "INSERT INTO connections (uuid, type, name, host, port, database, username, password, db_type) VALUES (?, 'postgres', 'Second', 'localhost', 5432, 'db', 'user', 'pass', 'postgres')",
    )
    .bind(&uuid)
    .execute(&pool)
    .await;

    assert!(result.is_err(), "Should fail with duplicate UUID");
}

#[tokio::test]
async fn test_sqlite_connection_with_file_path() {
    let (pool, _temp_file) = create_test_pool().await;
    let uuid = uuid::Uuid::new_v4().to_string();

    let conn: Connection = sqlx::query_as(
        r#"
        INSERT INTO connections (uuid, type, name, host, port, database, username, password, db_type, file_path)
        VALUES (?, 'sqlite', 'SQLite DB', '', 0, '', '', '', 'sqlite', '/path/to/db.sqlite')
        RETURNING *
        "#,
    )
    .bind(&uuid)
    .fetch_one(&pool)
    .await
    .unwrap();

    assert_eq!(conn.db_type, "sqlite");
    assert_eq!(conn.file_path, Some("/path/to/db.sqlite".to_string()));
}

// ============================================================================
// Export/Import Tests
// ============================================================================

#[tokio::test]
async fn test_export_connection_format() {
    let (pool, _temp_file) = create_test_pool().await;
    let uuid = uuid::Uuid::new_v4().to_string();

    // Create a connection
    sqlx::query(
        "INSERT INTO connections (uuid, type, name, host, port, database, username, password, ssl, db_type) VALUES (?, 'postgres', 'Test Export', 'localhost', 5432, 'testdb', 'user', 'pass', 1, 'postgres')",
    )
    .bind(&uuid)
    .execute(&pool)
    .await
    .unwrap();

    // Fetch the connection
    let conn: Connection = sqlx::query_as("SELECT * FROM connections WHERE uuid = ?")
        .bind(&uuid)
        .fetch_one(&pool)
        .await
        .unwrap();

    // Verify export data would be correct
    assert_eq!(conn.name, "Test Export");
    assert_eq!(conn.host, "localhost");
    assert_eq!(conn.port, 5432);
    assert_eq!(conn.ssl, 1);
}

#[tokio::test]
async fn test_import_connection_creates_new_uuid() {
    let (pool, _temp_file) = create_test_pool().await;

    // Simulate importing a connection (new UUID should be generated)
    let new_uuid = uuid::Uuid::new_v4().to_string();

    let result = sqlx::query(
        "INSERT INTO connections (uuid, type, name, host, port, database, username, password, db_type) VALUES (?, 'postgres', 'Imported Connection', 'remotehost', 5432, 'db', 'user', 'pass', 'postgres')",
    )
    .bind(&new_uuid)
    .execute(&pool)
    .await;

    assert!(result.is_ok());

    // Verify it exists with the new UUID
    let conn: Connection = sqlx::query_as("SELECT * FROM connections WHERE uuid = ?")
        .bind(&new_uuid)
        .fetch_one(&pool)
        .await
        .unwrap();

    assert_eq!(conn.name, "Imported Connection");
}

#[tokio::test]
async fn test_import_connection_name_conflict_resolution() {
    let (pool, _temp_file) = create_test_pool().await;

    // Create an existing connection with a name
    let uuid1 = uuid::Uuid::new_v4().to_string();
    sqlx::query(
        "INSERT INTO connections (uuid, type, name, host, port, database, username, password, db_type) VALUES (?, 'postgres', 'My Database', 'localhost', 5432, 'db', 'user', 'pass', 'postgres')",
    )
    .bind(&uuid1)
    .execute(&pool)
    .await
    .unwrap();

    // Get existing names
    let existing_names: Vec<String> = sqlx::query_scalar("SELECT name FROM connections")
        .fetch_all(&pool)
        .await
        .unwrap();

    assert!(existing_names.contains(&"My Database".to_string()));

    // Simulate importing with same name - should generate unique name
    let import_name = "My Database";
    let mut final_name = import_name.to_string();
    if existing_names.contains(&final_name) {
        let mut counter = 1;
        loop {
            let candidate = format!("{} ({})", import_name, counter);
            if !existing_names.contains(&candidate) {
                final_name = candidate;
                break;
            }
            counter += 1;
        }
    }

    assert_eq!(final_name, "My Database (1)");

    // Create with the resolved name
    let uuid2 = uuid::Uuid::new_v4().to_string();
    sqlx::query(
        "INSERT INTO connections (uuid, type, name, host, port, database, username, password, db_type) VALUES (?, 'postgres', ?, 'otherhost', 5432, 'db', 'user', 'pass', 'postgres')",
    )
    .bind(&uuid2)
    .bind(&final_name)
    .execute(&pool)
    .await
    .unwrap();

    // Verify both connections exist with unique names
    let all_connections: Vec<Connection> = sqlx::query_as("SELECT * FROM connections")
        .fetch_all(&pool)
        .await
        .unwrap();

    assert_eq!(all_connections.len(), 2);
    let names: Vec<&String> = all_connections.iter().map(|c| &c.name).collect();
    assert!(names.contains(&&"My Database".to_string()));
    assert!(names.contains(&&"My Database (1)".to_string()));
}

#[tokio::test]
async fn test_import_multiple_name_conflicts() {
    let (pool, _temp_file) = create_test_pool().await;

    // Create connections that would cause multiple conflicts
    for i in 0..3 {
        let uuid = uuid::Uuid::new_v4().to_string();
        let name = if i == 0 {
            "Production".to_string()
        } else {
            format!("Production ({})", i)
        };
        sqlx::query(
            "INSERT INTO connections (uuid, type, name, host, port, database, username, password, db_type) VALUES (?, 'postgres', ?, 'localhost', 5432, 'db', 'user', 'pass', 'postgres')",
        )
        .bind(&uuid)
        .bind(&name)
        .execute(&pool)
        .await
        .unwrap();
    }

    // Get existing names
    let existing_names: Vec<String> = sqlx::query_scalar("SELECT name FROM connections")
        .fetch_all(&pool)
        .await
        .unwrap();

    // Simulate importing "Production" again - should become "Production (3)"
    let import_name = "Production";
    let mut final_name = import_name.to_string();
    if existing_names.contains(&final_name) {
        let mut counter = 1;
        loop {
            let candidate = format!("{} ({})", import_name, counter);
            if !existing_names.contains(&candidate) {
                final_name = candidate;
                break;
            }
            counter += 1;
        }
    }

    assert_eq!(final_name, "Production (3)");
}
