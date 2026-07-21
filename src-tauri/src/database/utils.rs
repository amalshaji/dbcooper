use super::pool_manager::ConnectionConfig;
use sqlx::SqlitePool;

/// Build a ConnectionConfig from a saved connection record in SQLite.
/// Shared between Tauri commands and the MCP server.
pub async fn get_connection_config(
    sqlite_pool: &SqlitePool,
    uuid: &str,
) -> Result<ConnectionConfig, String> {
    let conn: crate::db::models::Connection =
        sqlx::query_as("SELECT * FROM connections WHERE uuid = ?")
            .bind(uuid)
            .fetch_one(sqlite_pool)
            .await
            .map_err(|e| format!("Failed to get connection: {}", e))?;

    Ok(ConnectionConfig {
        db_type: conn.db_type,
        host: Some(conn.host),
        port: Some(conn.port),
        database: Some(conn.database),
        username: Some(conn.username),
        password: Some(conn.password),
        ssl: Some(conn.ssl == 1),
        file_path: conn.file_path,
        ssh_enabled: conn.ssh_enabled == 1,
        ssh_host: if conn.ssh_host.is_empty() {
            None
        } else {
            Some(conn.ssh_host)
        },
        ssh_port: Some(conn.ssh_port),
        ssh_user: if conn.ssh_user.is_empty() {
            None
        } else {
            Some(conn.ssh_user)
        },
        ssh_password: if conn.ssh_password.is_empty() {
            None
        } else {
            Some(conn.ssh_password)
        },
        ssh_key_path: if conn.ssh_key_path.is_empty() {
            None
        } else {
            Some(conn.ssh_key_path)
        },
    })
}
