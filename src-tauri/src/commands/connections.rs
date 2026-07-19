use crate::database::pool_manager::PoolManager;
use crate::db::models::{Connection, ConnectionFormData};
use sqlx::SqlitePool;
use tauri::State;
use uuid::Uuid;

#[tauri::command]
pub async fn get_connections(pool: State<'_, SqlitePool>) -> Result<Vec<Connection>, String> {
    sqlx::query_as::<_, Connection>("SELECT * FROM connections ORDER BY id DESC")
        .fetch_all(pool.inner())
        .await
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn get_connection_by_uuid(
    pool: State<'_, SqlitePool>,
    uuid: String,
) -> Result<Connection, String> {
    sqlx::query_as::<_, Connection>("SELECT * FROM connections WHERE uuid = ?")
        .bind(&uuid)
        .fetch_one(pool.inner())
        .await
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn create_connection(
    pool: State<'_, SqlitePool>,
    data: ConnectionFormData,
) -> Result<Connection, String> {
    let uuid = Uuid::new_v4().to_string();
    let ssl = if data.ssl { 1 } else { 0 };
    let ssh_enabled = if data.ssh_enabled { 1 } else { 0 };
    let ssh_use_key = if data.ssh_use_key { 1 } else { 0 };

    sqlx::query_as::<_, Connection>(
        r#"
        INSERT INTO connections (uuid, type, name, host, port, database, username, password, ssl, db_type, file_path, ssh_enabled, ssh_host, ssh_port, ssh_user, ssh_password, ssh_key_path, ssh_use_key)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        RETURNING *
        "#,
    )
    .bind(&uuid)
    .bind(&data.connection_type)
    .bind(&data.name)
    .bind(&data.host)
    .bind(data.port)
    .bind(&data.database)
    .bind(&data.username)
    .bind(&data.password)
    .bind(ssl)
    .bind(&data.db_type)
    .bind(&data.file_path)
    .bind(ssh_enabled)
    .bind(&data.ssh_host)
    .bind(data.ssh_port)
    .bind(&data.ssh_user)
    .bind(&data.ssh_password)
    .bind(&data.ssh_key_path)
    .bind(ssh_use_key)
    .fetch_one(pool.inner())
    .await
    .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn update_connection(
    pool: State<'_, SqlitePool>,
    pool_manager: State<'_, PoolManager>,
    id: i64,
    data: ConnectionFormData,
) -> Result<Connection, String> {
    update_connection_inner(pool.inner(), &pool_manager, id, data).await
}

async fn update_connection_inner(
    pool: &SqlitePool,
    pool_manager: &PoolManager,
    id: i64,
    data: ConnectionFormData,
) -> Result<Connection, String> {
    let uuid: String = sqlx::query_scalar("SELECT uuid FROM connections WHERE id = ?")
        .bind(id)
        .fetch_one(pool)
        .await
        .map_err(|e| e.to_string())?;
    let lifecycle = pool_manager.connection_lifecycle(&uuid).await;
    let ssl = if data.ssl { 1 } else { 0 };
    let ssh_enabled = if data.ssh_enabled { 1 } else { 0 };
    let ssh_use_key = if data.ssh_use_key { 1 } else { 0 };

    let connection = sqlx::query_as::<_, Connection>(
        r#"
        UPDATE connections
        SET type = ?, name = ?, host = ?, port = ?, database = ?, username = ?, password = ?, ssl = ?,
            db_type = ?, file_path = ?,
            ssh_enabled = ?, ssh_host = ?, ssh_port = ?, ssh_user = ?, ssh_password = ?, ssh_key_path = ?, ssh_use_key = ?,
            updated_at = datetime('now')
        WHERE id = ?
        RETURNING *
        "#,
    )
    .bind(&data.connection_type)
    .bind(&data.name)
    .bind(&data.host)
    .bind(data.port)
    .bind(&data.database)
    .bind(&data.username)
    .bind(&data.password)
    .bind(ssl)
    .bind(&data.db_type)
    .bind(&data.file_path)
    .bind(ssh_enabled)
    .bind(&data.ssh_host)
    .bind(data.ssh_port)
    .bind(&data.ssh_user)
    .bind(&data.ssh_password)
    .bind(&data.ssh_key_path)
    .bind(ssh_use_key)
    .bind(id)
    .fetch_one(pool)
    .await
    .map_err(|e| e.to_string())?;
    lifecycle.invalidate().await;
    Ok(connection)
}

#[tauri::command]
pub async fn delete_connection(
    pool: State<'_, SqlitePool>,
    pool_manager: State<'_, PoolManager>,
    id: i64,
) -> Result<bool, String> {
    delete_connection_inner(pool.inner(), &pool_manager, id).await
}

async fn delete_connection_inner(
    pool: &SqlitePool,
    pool_manager: &PoolManager,
    id: i64,
) -> Result<bool, String> {
    let uuid: String = sqlx::query_scalar("SELECT uuid FROM connections WHERE id = ?")
        .bind(id)
        .fetch_one(pool)
        .await
        .map_err(|e| e.to_string())?;
    let lifecycle = pool_manager.connection_lifecycle(&uuid).await;
    sqlx::query("DELETE FROM connections WHERE id = ?")
        .bind(id)
        .execute(pool)
        .await
        .map_err(|e| e.to_string())?;
    lifecycle.invalidate().await;
    Ok(true)
}

/// Exported connection data (without id, uuid, timestamps)
#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
pub struct ExportedConnection {
    #[serde(rename = "type")]
    pub connection_type: String,
    pub name: String,
    pub host: String,
    pub port: i64,
    pub database: String,
    pub username: String,
    pub password: String,
    pub ssl: bool,
    pub db_type: String,
    pub file_path: Option<String>,
    pub ssh_enabled: bool,
    pub ssh_host: String,
    pub ssh_port: i64,
    pub ssh_user: String,
    pub ssh_password: String,
    pub ssh_key_path: String,
    pub ssh_use_key: bool,
}

/// Export file format
#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
pub struct ConnectionsExport {
    pub version: u32,
    pub exported_at: String,
    pub connections: Vec<ExportedConnection>,
}

#[tauri::command]
pub async fn export_connection(
    pool: State<'_, SqlitePool>,
    id: i64,
) -> Result<ConnectionsExport, String> {
    let connection = sqlx::query_as::<_, Connection>("SELECT * FROM connections WHERE id = ?")
        .bind(id)
        .fetch_one(pool.inner())
        .await
        .map_err(|e| e.to_string())?;

    let exported = ExportedConnection {
        connection_type: connection.connection_type,
        name: connection.name,
        host: connection.host,
        port: connection.port,
        database: connection.database,
        username: connection.username,
        password: connection.password,
        ssl: connection.ssl == 1,
        db_type: connection.db_type,
        file_path: connection.file_path,
        ssh_enabled: connection.ssh_enabled == 1,
        ssh_host: connection.ssh_host,
        ssh_port: connection.ssh_port,
        ssh_user: connection.ssh_user,
        ssh_password: connection.ssh_password,
        ssh_key_path: connection.ssh_key_path,
        ssh_use_key: connection.ssh_use_key == 1,
    };

    Ok(ConnectionsExport {
        version: 1,
        exported_at: chrono::Utc::now().to_rfc3339(),
        connections: vec![exported],
    })
}

#[tauri::command]
pub async fn import_connections(
    pool: State<'_, SqlitePool>,
    data: ConnectionsExport,
) -> Result<u32, String> {
    if data.version != 1 {
        return Err(format!(
            "Unsupported export version: {}. Expected version 1.",
            data.version
        ));
    }

    let mut imported_count = 0u32;

    // Get all existing connection names for conflict detection
    let existing_names: Vec<String> = sqlx::query_scalar("SELECT name FROM connections")
        .fetch_all(pool.inner())
        .await
        .map_err(|e| e.to_string())?;

    for conn in data.connections {
        let uuid = Uuid::new_v4().to_string();
        let ssl = if conn.ssl { 1 } else { 0 };
        let ssh_enabled = if conn.ssh_enabled { 1 } else { 0 };
        let ssh_use_key = if conn.ssh_use_key { 1 } else { 0 };

        // Generate a unique name if there's a conflict
        let mut final_name = conn.name.clone();
        if existing_names.contains(&final_name) {
            let mut counter = 1;
            loop {
                let candidate = format!("{} ({})", conn.name, counter);
                if !existing_names.contains(&candidate) {
                    final_name = candidate;
                    break;
                }
                counter += 1;
            }
        }

        let result = sqlx::query(
            r#"
            INSERT INTO connections (uuid, type, name, host, port, database, username, password, ssl, db_type, file_path, ssh_enabled, ssh_host, ssh_port, ssh_user, ssh_password, ssh_key_path, ssh_use_key)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            "#,
        )
        .bind(&uuid)
        .bind(&conn.connection_type)
        .bind(&final_name)
        .bind(&conn.host)
        .bind(conn.port)
        .bind(&conn.database)
        .bind(&conn.username)
        .bind(&conn.password)
        .bind(ssl)
        .bind(&conn.db_type)
        .bind(&conn.file_path)
        .bind(ssh_enabled)
        .bind(&conn.ssh_host)
        .bind(conn.ssh_port)
        .bind(&conn.ssh_user)
        .bind(&conn.ssh_password)
        .bind(&conn.ssh_key_path)
        .bind(ssh_use_key)
        .execute(pool.inner())
        .await;

        if result.is_ok() {
            imported_count += 1;
        }
    }

    Ok(imported_count)
}

#[cfg(test)]
mod tests {
    use super::{delete_connection_inner, update_connection_inner};
    use crate::database::pool_manager::{ConnectionConfig, PoolManager};
    use crate::db::models::ConnectionFormData;
    use sqlx::sqlite::SqlitePoolOptions;
    use std::sync::Arc;
    use tempfile::NamedTempFile;

    async fn test_metadata_pool() -> sqlx::SqlitePool {
        let pool = SqlitePoolOptions::new()
            .max_connections(1)
            .connect("sqlite::memory:")
            .await
            .unwrap();
        sqlx::query(
            r#"CREATE TABLE connections (
                id INTEGER PRIMARY KEY, uuid TEXT NOT NULL UNIQUE,
                type TEXT NOT NULL, name TEXT NOT NULL, host TEXT NOT NULL,
                port INTEGER NOT NULL, database TEXT NOT NULL, username TEXT NOT NULL,
                password TEXT NOT NULL, ssl INTEGER NOT NULL, db_type TEXT NOT NULL,
                file_path TEXT, ssh_enabled INTEGER NOT NULL, ssh_host TEXT NOT NULL,
                ssh_port INTEGER NOT NULL, ssh_user TEXT NOT NULL, ssh_password TEXT NOT NULL,
                ssh_key_path TEXT NOT NULL, ssh_use_key INTEGER NOT NULL,
                created_at TEXT NOT NULL DEFAULT (datetime('now')),
                updated_at TEXT NOT NULL DEFAULT (datetime('now'))
            )"#,
        )
        .execute(&pool)
        .await
        .unwrap();
        pool
    }

    async fn insert_connection(pool: &sqlx::SqlitePool, uuid: &str, file_path: &str) {
        sqlx::query(
            "INSERT INTO connections VALUES (1, ?, 'sqlite', 'test', '', 0, '', '', '', 0, 'sqlite', ?, 0, '', 22, '', '', '', 0, datetime('now'), datetime('now'))",
        )
        .bind(uuid)
        .bind(file_path)
        .execute(pool)
        .await
        .unwrap();
    }

    fn form(file_path: &str) -> ConnectionFormData {
        ConnectionFormData {
            connection_type: "sqlite".into(),
            name: "updated".into(),
            host: String::new(),
            port: 0,
            database: String::new(),
            username: String::new(),
            password: String::new(),
            ssl: false,
            db_type: "sqlite".into(),
            file_path: Some(file_path.into()),
            ssh_enabled: false,
            ssh_host: String::new(),
            ssh_port: 22,
            ssh_user: String::new(),
            ssh_password: String::new(),
            ssh_key_path: String::new(),
            ssh_use_key: false,
        }
    }

    async fn cache_sqlite(manager: &PoolManager, uuid: &str, file_path: &str) {
        let lifecycle = manager.connection_lifecycle(uuid).await;
        lifecycle
            .connect(ConnectionConfig {
                db_type: "sqlite".into(),
                host: None,
                port: None,
                database: None,
                username: None,
                password: None,
                ssl: None,
                file_path: Some(file_path.into()),
                ssh_enabled: false,
                ssh_host: None,
                ssh_port: None,
                ssh_user: None,
                ssh_password: None,
                ssh_key_path: None,
            })
            .await
            .unwrap();
    }

    #[tokio::test]
    async fn update_waits_for_lifecycle_and_invalidates_cached_driver() {
        let database = NamedTempFile::new().unwrap();
        let path = database.path().to_string_lossy().into_owned();
        let pool = Arc::new(test_metadata_pool().await);
        insert_connection(&pool, "connection-uuid", &path).await;
        let manager = Arc::new(PoolManager::new());
        cache_sqlite(&manager, "connection-uuid", &path).await;
        let lifecycle = manager.connection_lifecycle("connection-uuid").await;

        let task = tokio::spawn({
            let pool = pool.clone();
            let manager = manager.clone();
            let path = path.clone();
            async move { update_connection_inner(&pool, &manager, 1, form(&path)).await }
        });
        tokio::time::sleep(std::time::Duration::from_millis(25)).await;
        assert!(!task.is_finished());

        drop(lifecycle);
        task.await.unwrap().unwrap();
        assert!(manager.get_cached("connection-uuid").await.is_none());
    }

    #[tokio::test]
    async fn failed_delete_keeps_cached_driver() {
        let database = NamedTempFile::new().unwrap();
        let path = database.path().to_string_lossy().into_owned();
        let pool = test_metadata_pool().await;
        insert_connection(&pool, "connection-uuid", &path).await;
        let manager = PoolManager::new();
        cache_sqlite(&manager, "connection-uuid", &path).await;
        pool.close().await;

        assert!(delete_connection_inner(&pool, &manager, 1).await.is_err());
        assert!(manager.get_cached("connection-uuid").await.is_some());
    }

    #[tokio::test]
    async fn failed_update_keeps_cached_driver() {
        let database = NamedTempFile::new().unwrap();
        let path = database.path().to_string_lossy().into_owned();
        let pool = test_metadata_pool().await;
        insert_connection(&pool, "connection-uuid", &path).await;
        sqlx::query(
            "CREATE TRIGGER reject_update BEFORE UPDATE ON connections BEGIN SELECT RAISE(FAIL, 'rejected'); END",
        )
        .execute(&pool)
        .await
        .unwrap();
        let manager = PoolManager::new();
        cache_sqlite(&manager, "connection-uuid", &path).await;

        assert!(update_connection_inner(&pool, &manager, 1, form(&path))
            .await
            .is_err());
        assert!(manager.get_cached("connection-uuid").await.is_some());
    }
}
