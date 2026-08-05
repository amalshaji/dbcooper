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
    validate_connection_data(&data)?;
    let uuid = Uuid::new_v4().to_string();
    let ssl = if data.ssl { 1 } else { 0 };
    let ssh_enabled = if data.ssh_enabled { 1 } else { 0 };
    let ssh_use_key = if data.ssh_use_key { 1 } else { 0 };

    sqlx::query_as::<_, Connection>(
        r#"
        INSERT INTO connections (uuid, type, name, host, port, database, username, password, ssl, db_type, file_path, connection_uri, ssh_enabled, ssh_host, ssh_port, ssh_user, ssh_password, ssh_key_path, ssh_use_key)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
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
    .bind(data.db_type())
    .bind(&data.file_path)
    .bind(connection_uri_for(&data))
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
    validate_connection_data(&data)?;
    let ssl = if data.ssl { 1 } else { 0 };
    let ssh_enabled = if data.ssh_enabled { 1 } else { 0 };
    let ssh_use_key = if data.ssh_use_key { 1 } else { 0 };

    sqlx::query_as::<_, Connection>(
        r#"
        UPDATE connections
        SET type = ?, name = ?, host = ?, port = ?, database = ?, username = ?, password = ?, ssl = ?,
            db_type = ?, file_path = ?, connection_uri = ?,
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
    .bind(data.db_type())
    .bind(&data.file_path)
    .bind(connection_uri_for(&data))
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
pub async fn delete_connection(
    pool: State<'_, SqlitePool>,
    id: i64,
    delete_docker_data: Option<bool>,
) -> Result<crate::docker::DeleteConnectionResult, String> {
    crate::docker::delete_saved_connection(pool.inner(), id, delete_docker_data.unwrap_or(false))
        .await
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
    #[serde(default)]
    pub connection_uri: Option<String>,
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
        connection_uri: connection.connection_uri,
        ssh_enabled: connection.ssh_enabled == 1,
        ssh_host: connection.ssh_host,
        ssh_port: connection.ssh_port,
        ssh_user: connection.ssh_user,
        ssh_password: connection.ssh_password,
        ssh_key_path: connection.ssh_key_path,
        ssh_use_key: connection.ssh_use_key == 1,
    };

    Ok(ConnectionsExport {
        version: 2,
        exported_at: chrono::Utc::now().to_rfc3339(),
        connections: vec![exported],
    })
}

#[tauri::command]
pub async fn import_connections(
    pool: State<'_, SqlitePool>,
    data: ConnectionsExport,
) -> Result<u32, String> {
    if data.version != 1 && data.version != 2 {
        return Err(format!(
            "Unsupported export version: {}. Expected version 1 or 2.",
            data.version
        ));
    }
    if data.version == 1
        && data
            .connections
            .iter()
            .any(|connection| connection.db_type == "mongodb")
    {
        return Err("MongoDB connections require export version 2".to_string());
    }
    for connection in &data.connections {
        validate_connection_fields(
            &connection.connection_type,
            &connection.db_type,
            connection.ssh_enabled,
            connection.connection_uri.as_deref(),
        )?;
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
            INSERT INTO connections (uuid, type, name, host, port, database, username, password, ssl, db_type, file_path, connection_uri, ssh_enabled, ssh_host, ssh_port, ssh_user, ssh_password, ssh_key_path, ssh_use_key)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
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
        .bind(
            (conn.db_type == "mongodb")
                .then_some(conn.connection_uri.as_deref())
                .flatten(),
        )
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

fn validate_connection_data(data: &ConnectionFormData) -> Result<(), String> {
    validate_connection_fields(
        &data.connection_type,
        data.db_type(),
        data.ssh_enabled,
        data.connection_uri.as_deref(),
    )
}

fn validate_connection_fields(
    connection_type: &str,
    db_type: &str,
    ssh_enabled: bool,
    connection_uri: Option<&str>,
) -> Result<(), String> {
    let uses_mongodb = connection_type == "mongodb" || db_type == "mongodb";
    if !uses_mongodb {
        return Ok(());
    }
    if connection_type != "mongodb" || db_type != "mongodb" {
        return Err("MongoDB connection type and driver type must match".to_string());
    }
    if ssh_enabled {
        return Err("SSH tunnels are not supported for MongoDB".to_string());
    }
    let uri = connection_uri.ok_or_else(|| "MongoDB connection URI is required".to_string())?;
    crate::database::mongodb::validate_connection_uri(uri)
}

fn connection_uri_for(data: &ConnectionFormData) -> Option<&str> {
    (data.connection_type == "mongodb")
        .then_some(data.connection_uri.as_deref())
        .flatten()
}

#[cfg(test)]
mod tests {
    use super::validate_connection_fields;

    #[test]
    fn validates_form_and_import_driver_identity_through_one_boundary() {
        assert!(validate_connection_fields(
            "mongodb",
            "mongodb",
            false,
            Some("mongodb://localhost:27017/app"),
        )
        .is_ok());
        assert!(validate_connection_fields(
            "mongodb",
            "postgres",
            false,
            Some("mongodb://localhost:27017/app"),
        )
        .is_err());
    }
}
