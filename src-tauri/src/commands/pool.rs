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

/// Helper to get or create connection config from database
async fn get_connection_config(
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

/// Ensure connection exists, create if not (with lock to prevent concurrent reconnects)
async fn ensure_connection(
    pool_manager: &PoolManager,
    sqlite_pool: &SqlitePool,
    uuid: &str,
) -> Result<(), String> {
    // Acquire lock to serialize connect attempts for this UUID
    let lock = pool_manager.get_connect_lock(uuid).await;
    let _guard = lock.lock().await;

    // Check if already connected (another thread may have just connected)
    if pool_manager.get_cached(uuid).await.is_some() {
        return Ok(());
    }
    // Not connected, get config and connect
    let config = get_connection_config(sqlite_pool, uuid).await?;
    pool_manager.connect(uuid, config).await?;
    Ok(())
}

/// Disconnect and retry connect (with lock)
async fn reconnect(
    pool_manager: &PoolManager,
    sqlite_pool: &SqlitePool,
    uuid: &str,
) -> Result<(), String> {
    let lock = pool_manager.get_connect_lock(uuid).await;
    let _guard = lock.lock().await;

    // Disconnect stale connection
    pool_manager.disconnect(uuid).await;

    // Reconnect
    let config = get_connection_config(sqlite_pool, uuid).await?;
    pool_manager.connect(uuid, config).await?;
    Ok(())
}

/// List tables using the pooled connection (auto-connects if needed, auto-retries on error)
#[tauri::command]
pub async fn pool_list_tables(
    pool_manager: State<'_, PoolManager>,
    sqlite_pool: State<'_, SqlitePool>,
    uuid: String,
) -> Result<Vec<crate::db::models::TableInfo>, String> {
    // Ensure connected
    ensure_connection(&pool_manager, sqlite_pool.inner(), &uuid).await?;

    // Try the operation
    match pool_manager.list_tables(&uuid).await {
        Ok(result) => Ok(result),
        Err(e) => {
            // On error, disconnect and retry once with fresh connection
            println!(
                "[Pool] list_tables failed: {}, retrying with fresh connection",
                e
            );
            reconnect(&pool_manager, sqlite_pool.inner(), &uuid).await?;
            pool_manager.list_tables(&uuid).await
        }
    }
}

/// Get table data using the pooled connection (auto-connects if needed, auto-retries on error)
#[tauri::command]
pub async fn pool_get_table_data(
    pool_manager: State<'_, PoolManager>,
    sqlite_pool: State<'_, SqlitePool>,
    uuid: String,
    schema: String,
    table: String,
    page: i64,
    limit: i64,
    filter: Option<String>,
) -> Result<crate::db::models::TableDataResponse, String> {
    ensure_connection(&pool_manager, sqlite_pool.inner(), &uuid).await?;

    match pool_manager
        .get_table_data(&uuid, &schema, &table, page, limit, filter.clone())
        .await
    {
        Ok(result) => Ok(result),
        Err(e) => {
            println!(
                "[Pool] get_table_data failed: {}, retrying with fresh connection",
                e
            );
            reconnect(&pool_manager, sqlite_pool.inner(), &uuid).await?;
            pool_manager
                .get_table_data(&uuid, &schema, &table, page, limit, filter)
                .await
        }
    }
}

/// Get table structure using the pooled connection (auto-connects if needed, auto-retries on error)
#[tauri::command]
pub async fn pool_get_table_structure(
    pool_manager: State<'_, PoolManager>,
    sqlite_pool: State<'_, SqlitePool>,
    uuid: String,
    schema: String,
    table: String,
) -> Result<crate::db::models::TableStructure, String> {
    ensure_connection(&pool_manager, sqlite_pool.inner(), &uuid).await?;

    match pool_manager
        .get_table_structure(&uuid, &schema, &table)
        .await
    {
        Ok(result) => Ok(result),
        Err(e) => {
            println!(
                "[Pool] get_table_structure failed: {}, retrying with fresh connection",
                e
            );
            reconnect(&pool_manager, sqlite_pool.inner(), &uuid).await?;
            pool_manager
                .get_table_structure(&uuid, &schema, &table)
                .await
        }
    }
}

/// Execute query using the pooled connection (auto-connects if needed, auto-retries on error)
#[tauri::command]
pub async fn pool_execute_query(
    pool_manager: State<'_, PoolManager>,
    sqlite_pool: State<'_, SqlitePool>,
    uuid: String,
    query: String,
) -> Result<crate::db::models::QueryResult, String> {
    ensure_connection(&pool_manager, sqlite_pool.inner(), &uuid).await?;

    match pool_manager.execute_query(&uuid, &query).await {
        Ok(result) => Ok(result),
        Err(e) => {
            println!(
                "[Pool] execute_query failed: {}, retrying with fresh connection",
                e
            );
            reconnect(&pool_manager, sqlite_pool.inner(), &uuid).await?;
            pool_manager.execute_query(&uuid, &query).await
        }
    }
}

/// Get schema overview using the pooled connection (auto-connects if needed, auto-retries on error)
#[tauri::command]
pub async fn pool_get_schema_overview(
    pool_manager: State<'_, PoolManager>,
    sqlite_pool: State<'_, SqlitePool>,
    uuid: String,
) -> Result<crate::db::models::SchemaOverview, String> {
    ensure_connection(&pool_manager, sqlite_pool.inner(), &uuid).await?;

    match pool_manager.get_schema_overview(&uuid).await {
        Ok(result) => Ok(result),
        Err(e) => {
            println!(
                "[Pool] get_schema_overview failed: {}, retrying with fresh connection",
                e
            );
            reconnect(&pool_manager, sqlite_pool.inner(), &uuid).await?;
            pool_manager.get_schema_overview(&uuid).await
        }
    }
}
