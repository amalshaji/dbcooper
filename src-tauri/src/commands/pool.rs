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
    sort_column: Option<String>,
    sort_direction: Option<String>,
) -> Result<crate::db::models::TableDataResponse, String> {
    ensure_connection(&pool_manager, sqlite_pool.inner(), &uuid).await?;

    match pool_manager
        .get_table_data(&uuid, &schema, &table, page, limit, filter.clone(), sort_column.clone(), sort_direction.clone())
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
                .get_table_data(&uuid, &schema, &table, page, limit, filter, sort_column, sort_direction)
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

// ============================================================================
// Row editing commands (UPDATE/DELETE/INSERT) using connection pool
// ============================================================================

use crate::commands::database::{escape_sql_identifier, format_sql_value, validate_raw_sql_value};

/// Update a row in a table using the pooled connection
#[tauri::command]
pub async fn pool_update_table_row(
    pool_manager: State<'_, PoolManager>,
    sqlite_pool: State<'_, SqlitePool>,
    uuid: String,
    schema: String,
    table: String,
    primary_key_columns: Vec<String>,
    primary_key_values: Vec<serde_json::Value>,
    updates: Vec<serde_json::Value>,
) -> Result<crate::db::models::QueryResult, String> {
    if primary_key_columns.is_empty() || primary_key_columns.len() != primary_key_values.len() {
        return Err("Primary key columns and values must match".to_string());
    }

    if updates.is_empty() {
        return Err("No updates provided".to_string());
    }

    // Get db_type from connection
    let conn: crate::db::models::Connection =
        sqlx::query_as("SELECT * FROM connections WHERE uuid = ?")
            .bind(&uuid)
            .fetch_one(sqlite_pool.inner())
            .await
            .map_err(|e| format!("Failed to get connection: {}", e))?;

    let db_type = &conn.db_type;

    // Build the UPDATE query
    let table_ref = if db_type == "sqlite" || db_type == "sqlite3" {
        format!("\"{}\"", escape_sql_identifier(&table))
    } else {
        format!(
            "\"{}\".\"{}\"",
            escape_sql_identifier(&schema),
            escape_sql_identifier(&table)
        )
    };

    // Extract columns and values from the updates array
    let mut set_parts: Vec<String> = Vec::new();

    for update_obj in updates.iter() {
        let update_map = update_obj
            .as_object()
            .ok_or("Each update must be an object")?;

        let column = update_map
            .get("column")
            .and_then(|v| v.as_str())
            .ok_or("Missing column name")?;
        let value = update_map.get("value").ok_or("Missing value")?;
        let is_raw_sql = update_map
            .get("isRawSql")
            .and_then(|v| v.as_bool())
            .unwrap_or(false);

        let formatted_value = if is_raw_sql {
            let raw_value = value.as_str().ok_or("Raw SQL value must be a string")?;
            validate_raw_sql_value(raw_value, db_type)
                .map_err(|e| format!("Invalid raw SQL value: {}", e))?;
            raw_value.to_string()
        } else {
            format_sql_value(value)
        };

        set_parts.push(format!(
            "\"{}\" = {}",
            escape_sql_identifier(column),
            formatted_value
        ));
    }

    let set_clause = set_parts.join(", ");

    // Build WHERE clause for primary key
    let where_parts: Vec<String> = primary_key_columns
        .iter()
        .zip(primary_key_values.iter())
        .map(|(col, val)| {
            let formatted_value = format_sql_value(val);
            format!("\"{}\" = {}", escape_sql_identifier(col), formatted_value)
        })
        .collect();
    let where_clause = where_parts.join(" AND ");

    let query = format!(
        "UPDATE {} SET {} WHERE {}",
        table_ref, set_clause, where_clause
    );

    ensure_connection(&pool_manager, sqlite_pool.inner(), &uuid).await?;

    match pool_manager.execute_query(&uuid, &query).await {
        Ok(result) => Ok(result),
        Err(e) => {
            println!(
                "[Pool] update_table_row failed: {}, retrying with fresh connection",
                e
            );
            reconnect(&pool_manager, sqlite_pool.inner(), &uuid).await?;
            pool_manager.execute_query(&uuid, &query).await
        }
    }
}

/// Delete a row from a table using the pooled connection
#[tauri::command]
pub async fn pool_delete_table_row(
    pool_manager: State<'_, PoolManager>,
    sqlite_pool: State<'_, SqlitePool>,
    uuid: String,
    schema: String,
    table: String,
    primary_key_columns: Vec<String>,
    primary_key_values: Vec<serde_json::Value>,
) -> Result<crate::db::models::QueryResult, String> {
    if primary_key_columns.is_empty() || primary_key_columns.len() != primary_key_values.len() {
        return Err("Primary key columns and values must match".to_string());
    }

    // Get db_type from connection
    let conn: crate::db::models::Connection =
        sqlx::query_as("SELECT * FROM connections WHERE uuid = ?")
            .bind(&uuid)
            .fetch_one(sqlite_pool.inner())
            .await
            .map_err(|e| format!("Failed to get connection: {}", e))?;

    let db_type = &conn.db_type;

    // Build the DELETE query
    let table_ref = if db_type == "sqlite" || db_type == "sqlite3" {
        format!("\"{}\"", escape_sql_identifier(&table))
    } else {
        format!(
            "\"{}\".\"{}\"",
            escape_sql_identifier(&schema),
            escape_sql_identifier(&table)
        )
    };

    // Build WHERE clause for primary key
    let where_parts: Vec<String> = primary_key_columns
        .iter()
        .zip(primary_key_values.iter())
        .map(|(col, val)| {
            let formatted_value = format_sql_value(val);
            format!("\"{}\" = {}", escape_sql_identifier(col), formatted_value)
        })
        .collect();
    let where_clause = where_parts.join(" AND ");

    let query = format!("DELETE FROM {} WHERE {}", table_ref, where_clause);

    ensure_connection(&pool_manager, sqlite_pool.inner(), &uuid).await?;

    match pool_manager.execute_query(&uuid, &query).await {
        Ok(result) => Ok(result),
        Err(e) => {
            println!(
                "[Pool] delete_table_row failed: {}, retrying with fresh connection",
                e
            );
            reconnect(&pool_manager, sqlite_pool.inner(), &uuid).await?;
            pool_manager.execute_query(&uuid, &query).await
        }
    }
}

/// Insert a new row into a table using the pooled connection
#[tauri::command]
pub async fn pool_insert_table_row(
    pool_manager: State<'_, PoolManager>,
    sqlite_pool: State<'_, SqlitePool>,
    uuid: String,
    schema: String,
    table: String,
    values: Vec<serde_json::Value>,
) -> Result<crate::db::models::QueryResult, String> {
    if values.is_empty() {
        return Err("No values provided".to_string());
    }

    // Get db_type from connection
    let conn: crate::db::models::Connection =
        sqlx::query_as("SELECT * FROM connections WHERE uuid = ?")
            .bind(&uuid)
            .fetch_one(sqlite_pool.inner())
            .await
            .map_err(|e| format!("Failed to get connection: {}", e))?;

    let db_type = &conn.db_type;

    // Build the INSERT query
    let table_ref = if db_type == "sqlite" || db_type == "sqlite3" {
        format!("\"{}\"", escape_sql_identifier(&table))
    } else {
        format!(
            "\"{}\".\"{}\"",
            escape_sql_identifier(&schema),
            escape_sql_identifier(&table)
        )
    };

    // Extract columns and values from the values array
    let mut columns: Vec<String> = Vec::new();
    let mut value_parts: Vec<String> = Vec::new();

    for value_obj in values.iter() {
        let value_map = value_obj
            .as_object()
            .ok_or("Each value must be an object")?;

        let column = value_map
            .get("column")
            .and_then(|v| v.as_str())
            .ok_or("Missing column name")?;
        let value = value_map.get("value").ok_or("Missing value")?;
        let is_raw_sql = value_map
            .get("isRawSql")
            .and_then(|v| v.as_bool())
            .unwrap_or(false);

        columns.push(format!("\"{}\"", escape_sql_identifier(column)));

        let formatted_value = if is_raw_sql {
            let raw_value = value.as_str().ok_or("Raw SQL value must be a string")?;
            validate_raw_sql_value(raw_value, db_type)
                .map_err(|e| format!("Invalid raw SQL value: {}", e))?;
            raw_value.to_string()
        } else {
            format_sql_value(value)
        };

        value_parts.push(formatted_value);
    }

    let columns_clause = columns.join(", ");
    let values_clause = value_parts.join(", ");

    let query = format!(
        "INSERT INTO {} ({}) VALUES ({})",
        table_ref, columns_clause, values_clause
    );

    ensure_connection(&pool_manager, sqlite_pool.inner(), &uuid).await?;

    match pool_manager.execute_query(&uuid, &query).await {
        Ok(result) => Ok(result),
        Err(e) => {
            println!(
                "[Pool] insert_table_row failed: {}, retrying with fresh connection",
                e
            );
            reconnect(&pool_manager, sqlite_pool.inner(), &uuid).await?;
            pool_manager.execute_query(&uuid, &query).await
        }
    }
}
