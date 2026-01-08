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
    id: i64,
    data: ConnectionFormData,
) -> Result<Connection, String> {
    let ssl = if data.ssl { 1 } else { 0 };
    let ssh_enabled = if data.ssh_enabled { 1 } else { 0 };
    let ssh_use_key = if data.ssh_use_key { 1 } else { 0 };

    sqlx::query_as::<_, Connection>(
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
    .fetch_one(pool.inner())
    .await
    .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn delete_connection(pool: State<'_, SqlitePool>, id: i64) -> Result<bool, String> {
    sqlx::query("DELETE FROM connections WHERE id = ?")
        .bind(id)
        .execute(pool.inner())
        .await
        .map(|_| true)
        .map_err(|e| e.to_string())
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
