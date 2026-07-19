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
    let lifecycle = pool_manager.connection_lifecycle(&uuid).await;

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

    match lifecycle.connect(config).await {
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
    let lifecycle = pool_manager.connection_lifecycle(&uuid).await;
    lifecycle.invalidate().await;
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
    let lifecycle = pool_manager.connection_lifecycle(uuid).await;

    // Check if already connected (another thread may have just connected)
    if pool_manager.get_cached(uuid).await.is_some() {
        return Ok(());
    }
    // Not connected, get config and connect
    let config = get_connection_config(sqlite_pool, uuid).await?;
    lifecycle.connect(config).await?;
    Ok(())
}

/// Disconnect and retry connect (with lock)
async fn reconnect(
    pool_manager: &PoolManager,
    sqlite_pool: &SqlitePool,
    uuid: &str,
) -> Result<(), String> {
    let lifecycle = pool_manager.connection_lifecycle(uuid).await;

    // Disconnect stale connection
    lifecycle.invalidate().await;

    // Reconnect
    let config = get_connection_config(sqlite_pool, uuid).await?;
    lifecycle.connect(config).await?;
    Ok(())
}

#[derive(Clone, Copy)]
enum RetryPolicy {
    Never,
    ReconnectOnce,
}

async fn execute_with_retry_policy<T, Operation, OperationFuture, Reconnect, ReconnectFuture>(
    operation_name: &str,
    retry_policy: RetryPolicy,
    mut operation: Operation,
    reconnect: Reconnect,
) -> Result<T, String>
where
    Operation: FnMut() -> OperationFuture,
    OperationFuture: std::future::Future<Output = Result<T, String>>,
    Reconnect: FnOnce() -> ReconnectFuture,
    ReconnectFuture: std::future::Future<Output = Result<(), String>>,
{
    match operation().await {
        Ok(result) => Ok(result),
        Err(error) if matches!(retry_policy, RetryPolicy::Never) => Err(error),
        Err(error) => {
            println!(
                "[Pool] {} failed: {}, retrying with fresh connection",
                operation_name, error
            );
            reconnect().await?;
            operation().await
        }
    }
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

    execute_with_retry_policy(
        "list_tables",
        RetryPolicy::ReconnectOnce,
        || pool_manager.list_tables(&uuid),
        || reconnect(&pool_manager, sqlite_pool.inner(), &uuid),
    )
    .await
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
    structured_filter: Option<crate::db::models::FilterExpression>,
    sort_column: Option<String>,
    sort_direction: Option<String>,
) -> Result<crate::db::models::TableDataResponse, String> {
    ensure_connection(&pool_manager, sqlite_pool.inner(), &uuid).await?;
    let table_filter = crate::db::models::TableFilter::from_parts(filter, structured_filter)?;

    execute_with_retry_policy(
        "get_table_data",
        RetryPolicy::ReconnectOnce,
        || {
            pool_manager.get_table_data(
                &uuid,
                &schema,
                &table,
                page,
                limit,
                table_filter.clone(),
                sort_column.clone(),
                sort_direction.clone(),
            )
        },
        || reconnect(&pool_manager, sqlite_pool.inner(), &uuid),
    )
    .await
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

    execute_with_retry_policy(
        "get_table_structure",
        RetryPolicy::ReconnectOnce,
        || pool_manager.get_table_structure(&uuid, &schema, &table),
        || reconnect(&pool_manager, sqlite_pool.inner(), &uuid),
    )
    .await
}

/// Execute arbitrary SQL using the pooled connection without retrying driver errors
#[tauri::command]
pub async fn pool_execute_query(
    pool_manager: State<'_, PoolManager>,
    sqlite_pool: State<'_, SqlitePool>,
    uuid: String,
    query: String,
) -> Result<crate::db::models::QueryResult, String> {
    ensure_connection(&pool_manager, sqlite_pool.inner(), &uuid).await?;

    execute_with_retry_policy(
        "execute_query",
        RetryPolicy::Never,
        || pool_manager.execute_query(&uuid, &query),
        || reconnect(&pool_manager, sqlite_pool.inner(), &uuid),
    )
    .await
}

/// Get schema overview using the pooled connection (auto-connects if needed, auto-retries on error)
#[tauri::command]
pub async fn pool_get_schema_overview(
    pool_manager: State<'_, PoolManager>,
    sqlite_pool: State<'_, SqlitePool>,
    uuid: String,
) -> Result<crate::db::models::SchemaOverview, String> {
    ensure_connection(&pool_manager, sqlite_pool.inner(), &uuid).await?;

    execute_with_retry_policy(
        "get_schema_overview",
        RetryPolicy::ReconnectOnce,
        || pool_manager.get_schema_overview(&uuid),
        || reconnect(&pool_manager, sqlite_pool.inner(), &uuid),
    )
    .await
}

/// Get a function definition using the pooled connection (auto-connects if needed, auto-retries on error)
#[tauri::command]
pub async fn pool_get_function_definition(
    pool_manager: State<'_, PoolManager>,
    sqlite_pool: State<'_, SqlitePool>,
    uuid: String,
    schema: String,
    name: String,
    identity_args: String,
) -> Result<crate::db::models::FunctionDefinition, String> {
    ensure_connection(&pool_manager, sqlite_pool.inner(), &uuid).await?;

    execute_with_retry_policy(
        "get_function_definition",
        RetryPolicy::ReconnectOnce,
        || pool_manager.get_function_definition(&uuid, &schema, &name, &identity_args),
        || reconnect(&pool_manager, sqlite_pool.inner(), &uuid),
    )
    .await
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

    execute_with_retry_policy(
        "update_table_row",
        RetryPolicy::Never,
        || pool_manager.execute_query(&uuid, &query),
        || reconnect(&pool_manager, sqlite_pool.inner(), &uuid),
    )
    .await
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

    execute_with_retry_policy(
        "delete_table_row",
        RetryPolicy::Never,
        || pool_manager.execute_query(&uuid, &query),
        || reconnect(&pool_manager, sqlite_pool.inner(), &uuid),
    )
    .await
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

    execute_with_retry_policy(
        "insert_table_row",
        RetryPolicy::Never,
        || pool_manager.execute_query(&uuid, &query),
        || reconnect(&pool_manager, sqlite_pool.inner(), &uuid),
    )
    .await
}

#[cfg(test)]
mod tests {
    use super::{execute_with_retry_policy, RetryPolicy};
    use std::cell::Cell;

    #[tokio::test]
    async fn never_retry_policy_returns_first_error_without_reconnect() {
        for command in ["arbitrary SQL", "update", "delete", "insert"] {
            let operation_calls = Cell::new(0);
            let reconnect_calls = Cell::new(0);

            let result: Result<(), String> = execute_with_retry_policy(
                command,
                RetryPolicy::Never,
                || async {
                    operation_calls.set(operation_calls.get() + 1);
                    Err(format!("{command} failed"))
                },
                || async {
                    reconnect_calls.set(reconnect_calls.get() + 1);
                    Ok(())
                },
            )
            .await;

            assert_eq!(result, Err(format!("{command} failed")));
            assert_eq!(operation_calls.get(), 1, "{command}");
            assert_eq!(reconnect_calls.get(), 0, "{command}");
        }
    }

    #[tokio::test]
    async fn read_only_policy_reconnects_once_and_runs_operation_twice() {
        let operation_calls = Cell::new(0);
        let reconnect_calls = Cell::new(0);

        let result = execute_with_retry_policy(
            "test_read",
            RetryPolicy::ReconnectOnce,
            || async {
                operation_calls.set(operation_calls.get() + 1);
                if operation_calls.get() == 1 {
                    Err("stale connection".to_string())
                } else {
                    Ok("rows")
                }
            },
            || async {
                reconnect_calls.set(reconnect_calls.get() + 1);
                Ok(())
            },
        )
        .await;

        assert_eq!(result, Ok("rows"));
        assert_eq!(operation_calls.get(), 2);
        assert_eq!(reconnect_calls.get(), 1);
    }
}
