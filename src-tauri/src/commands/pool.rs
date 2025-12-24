//! Pool management Tauri commands
//!
//! Commands for managing the connection pool: connect, disconnect, status, health check.

use crate::database::pool_manager::{ConnectionConfig, ConnectionStatus, PoolManager};
use crate::db::models::TestConnectionResult;
use serde::{Deserialize, Serialize};
use sqlx::SqlitePool;
use tauri::State;

/// Response for connection status
#[derive(Serialize, Deserialize)]
pub struct ConnectionStatusResponse {
    pub status: ConnectionStatus,
    pub error: Option<String>,
}

/// Connect to a database and add to pool
#[tauri::command]
pub async fn pool_connect(
    pool_manager: State<'_, PoolManager>,
    sqlite_pool: State<'_, SqlitePool>,
    uuid: String,
) -> Result<ConnectionStatusResponse, String> {
    // Get connection details from database
    let conn: crate::db::models::Connection =
        sqlx::query_as("SELECT * FROM connections WHERE uuid = ?")
            .bind(&uuid)
            .fetch_one(sqlite_pool.inner())
            .await
            .map_err(|e| format!("Failed to get connection: {}", e))?;

    let config = ConnectionConfig {
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
    };

    match pool_manager.connect(&uuid, config).await {
        Ok(_) => Ok(ConnectionStatusResponse {
            status: ConnectionStatus::Connected,
            error: None,
        }),
        Err(e) => Ok(ConnectionStatusResponse {
            status: ConnectionStatus::Disconnected,
            error: Some(e),
        }),
    }
}

/// Disconnect from a database and remove from pool
#[tauri::command]
pub async fn pool_disconnect(
    pool_manager: State<'_, PoolManager>,
    uuid: String,
) -> Result<(), String> {
    pool_manager.disconnect(&uuid).await;
    Ok(())
}

/// Get the current status of a connection
#[tauri::command]
pub async fn pool_get_status(
    pool_manager: State<'_, PoolManager>,
    uuid: String,
) -> Result<ConnectionStatusResponse, String> {
    let status = pool_manager.get_status(&uuid).await;
    let error = pool_manager.get_last_error(&uuid).await;
    Ok(ConnectionStatusResponse { status, error })
}

/// Perform a health check on a connection
#[tauri::command]
pub async fn pool_health_check(
    pool_manager: State<'_, PoolManager>,
    uuid: String,
) -> Result<TestConnectionResult, String> {
    pool_manager.health_check(&uuid).await
}
