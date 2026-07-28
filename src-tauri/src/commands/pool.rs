//! Pool management Tauri commands
//!
//! Commands for managing the connection pool: connect, disconnect, status, health check.

use std::sync::Arc;

use crate::database::mutation::{
    build_delete, build_insert, build_update, MutationPlan, MutationValue,
};
use crate::database::pool_manager::{ConnectionStatus, PoolManager};
use crate::database::sql_policy::ensure_structured_mutations_supported;
use crate::database::DatabaseType;
use crate::db::models::{
    Connection, CreateTableRequest, QueryResult, TableInfo, TestConnectionResult,
};
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
    pool_manager: State<'_, Arc<PoolManager>>,
    sqlite_pool: State<'_, SqlitePool>,
    uuid: String,
) -> Result<ConnectionStatusResponse, String> {
    // Serialize with data-op (re)connects for this UUID so a UI-initiated
    // connect can't race a concurrent ensure_connection/reconnect.
    let lock = pool_manager.get_connect_lock(&uuid).await;
    let _guard = lock.lock().await;
    crate::docker::ensure_created_connection_running(sqlite_pool.inner(), &uuid).await?;
    let config = crate::database::utils::get_connection_config(sqlite_pool.inner(), &uuid).await?;

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
    pool_manager: State<'_, Arc<PoolManager>>,
    uuid: String,
) -> Result<(), String> {
    pool_manager.disconnect(&uuid).await;
    Ok(())
}

/// Get the current status of a connection
#[tauri::command]
pub async fn pool_get_status(
    pool_manager: State<'_, Arc<PoolManager>>,
    uuid: String,
) -> Result<ConnectionStatusResponse, String> {
    let status = pool_manager.get_status(&uuid).await;
    let error = pool_manager.get_last_error(&uuid).await;
    Ok(ConnectionStatusResponse { status, error })
}

/// Perform a health check on a connection
#[tauri::command]
pub async fn pool_health_check(
    pool_manager: State<'_, Arc<PoolManager>>,
    uuid: String,
) -> Result<TestConnectionResult, String> {
    pool_manager.health_check(&uuid).await
}

/// Ensure connection exists, create if not (serialized per-UUID).
async fn ensure_connection(
    pool_manager: &PoolManager,
    sqlite_pool: &SqlitePool,
    uuid: &str,
) -> Result<(), String> {
    pool_manager.ensure_connected(sqlite_pool, uuid).await
}

/// Disconnect and reconnect (with lock).
async fn reconnect(
    pool_manager: &PoolManager,
    sqlite_pool: &SqlitePool,
    uuid: &str,
) -> Result<(), String> {
    let lock = pool_manager.get_connect_lock(uuid).await;
    let _guard = lock.lock().await;

    // Disconnect stale connection
    pool_manager.disconnect_locked(uuid).await;

    crate::docker::ensure_created_connection_running(sqlite_pool, uuid).await?;
    let config = crate::database::utils::get_connection_config(sqlite_pool, uuid).await?;
    pool_manager.connect(uuid, config).await?;
    Ok(())
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
enum RetryPolicy {
    Never,
    ReconnectOnce,
}

async fn read_retry_policy(pool_manager: &PoolManager, uuid: &str) -> RetryPolicy {
    if pool_manager.allows_reconnect_retry(uuid).await {
        RetryPolicy::ReconnectOnce
    } else {
        RetryPolicy::Never
    }
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
        Err(error) if retry_policy == RetryPolicy::Never => Err(error),
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

pub(crate) async fn with_pooled_read<T, F, Fut>(
    pool_manager: &PoolManager,
    sqlite_pool: &SqlitePool,
    uuid: &str,
    operation_name: &str,
    operation: F,
) -> Result<T, String>
where
    F: FnMut() -> Fut,
    Fut: std::future::Future<Output = Result<T, String>>,
{
    ensure_connection(pool_manager, sqlite_pool, uuid).await?;
    execute_with_retry_policy(
        operation_name,
        read_retry_policy(pool_manager, uuid).await,
        operation,
        || reconnect(pool_manager, sqlite_pool, uuid),
    )
    .await
}

pub(crate) async fn with_pooled_no_retry<T, F, Fut>(
    pool_manager: &PoolManager,
    sqlite_pool: &SqlitePool,
    uuid: &str,
    _operation_name: &str,
    operation: F,
) -> Result<T, String>
where
    F: FnOnce() -> Fut,
    Fut: std::future::Future<Output = Result<T, String>>,
{
    ensure_connection(pool_manager, sqlite_pool, uuid).await?;
    operation().await
}

/// List tables using the pooled connection (auto-connects if needed, auto-retries on error)
#[tauri::command]
pub async fn pool_list_tables(
    pool_manager: State<'_, Arc<PoolManager>>,
    sqlite_pool: State<'_, SqlitePool>,
    uuid: String,
) -> Result<Vec<crate::db::models::TableInfo>, String> {
    ensure_connection(&pool_manager, sqlite_pool.inner(), &uuid).await?;

    execute_with_retry_policy(
        "list_tables",
        read_retry_policy(&pool_manager, &uuid).await,
        || pool_manager.list_tables(&uuid),
        || reconnect(&pool_manager, sqlite_pool.inner(), &uuid),
    )
    .await
}

/// Get table data using the pooled connection (auto-connects if needed, auto-retries on error)
#[tauri::command]
pub async fn pool_get_table_data(
    pool_manager: State<'_, Arc<PoolManager>>,
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
    let table_filter = crate::db::models::TableFilter::from_parts(filter, structured_filter)?;

    ensure_connection(&pool_manager, sqlite_pool.inner(), &uuid).await?;
    execute_with_retry_policy(
        "get_table_data",
        read_retry_policy(&pool_manager, &uuid).await,
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
    pool_manager: State<'_, Arc<PoolManager>>,
    sqlite_pool: State<'_, SqlitePool>,
    uuid: String,
    schema: String,
    table: String,
) -> Result<crate::db::models::TableStructure, String> {
    ensure_connection(&pool_manager, sqlite_pool.inner(), &uuid).await?;

    execute_with_retry_policy(
        "get_table_structure",
        read_retry_policy(&pool_manager, &uuid).await,
        || pool_manager.get_table_structure(&uuid, &schema, &table),
        || reconnect(&pool_manager, sqlite_pool.inner(), &uuid),
    )
    .await
}

#[tauri::command]
pub async fn pool_preview_create_table(
    pool_manager: State<'_, Arc<PoolManager>>,
    sqlite_pool: State<'_, SqlitePool>,
    uuid: String,
    request: CreateTableRequest,
) -> Result<String, String> {
    ensure_connection(&pool_manager, sqlite_pool.inner(), &uuid).await?;
    pool_manager.preview_create_table(&uuid, &request).await
}

#[tauri::command]
pub async fn pool_create_table(
    pool_manager: State<'_, Arc<PoolManager>>,
    sqlite_pool: State<'_, SqlitePool>,
    uuid: String,
    request: CreateTableRequest,
) -> Result<TableInfo, String> {
    ensure_connection(&pool_manager, sqlite_pool.inner(), &uuid).await?;
    pool_manager.create_table(&uuid, &request).await
}

/// Execute query using the pooled connection (auto-connects if needed, auto-retries on error)
#[tauri::command]
pub async fn pool_execute_query(
    pool_manager: State<'_, Arc<PoolManager>>,
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
    pool_manager: State<'_, Arc<PoolManager>>,
    sqlite_pool: State<'_, SqlitePool>,
    uuid: String,
) -> Result<crate::db::models::SchemaOverview, String> {
    ensure_connection(&pool_manager, sqlite_pool.inner(), &uuid).await?;

    execute_with_retry_policy(
        "get_schema_overview",
        read_retry_policy(&pool_manager, &uuid).await,
        || pool_manager.get_schema_overview(&uuid),
        || reconnect(&pool_manager, sqlite_pool.inner(), &uuid),
    )
    .await
}

/// Get a function definition using the pooled connection (auto-connects if needed, auto-retries on error)
#[tauri::command]
pub async fn pool_get_function_definition(
    pool_manager: State<'_, Arc<PoolManager>>,
    sqlite_pool: State<'_, SqlitePool>,
    uuid: String,
    schema: String,
    name: String,
    identity_args: String,
) -> Result<crate::db::models::FunctionDefinition, String> {
    ensure_connection(&pool_manager, sqlite_pool.inner(), &uuid).await?;

    execute_with_retry_policy(
        "get_function_definition",
        read_retry_policy(&pool_manager, &uuid).await,
        || pool_manager.get_function_definition(&uuid, &schema, &name, &identity_args),
        || reconnect(&pool_manager, sqlite_pool.inner(), &uuid),
    )
    .await
}

// ============================================================================
// Row editing commands (UPDATE/DELETE/INSERT) using connection pool
// ============================================================================

async fn mutation_engine(sqlite_pool: &SqlitePool, uuid: &str) -> Result<DatabaseType, String> {
    let connection: Connection = sqlx::query_as("SELECT * FROM connections WHERE uuid = ?")
        .bind(uuid)
        .fetch_one(sqlite_pool)
        .await
        .map_err(|error| format!("Failed to get connection: {error}"))?;
    ensure_structured_mutations_supported(&connection.db_type)?;
    DatabaseType::try_from(connection.db_type.as_str())
}

async fn run_mutation(
    pool_manager: &PoolManager,
    sqlite_pool: &SqlitePool,
    uuid: &str,
    mutation: &MutationPlan,
) -> Result<QueryResult, String> {
    ensure_connection(pool_manager, sqlite_pool, uuid).await?;
    pool_manager.execute_mutation(uuid, mutation).await
}

/// Update a row in a table using the pooled connection
#[tauri::command]
pub async fn pool_update_table_row(
    pool_manager: State<'_, Arc<PoolManager>>,
    sqlite_pool: State<'_, SqlitePool>,
    uuid: String,
    schema: String,
    table: String,
    primary_key_columns: Vec<String>,
    primary_key_values: Vec<serde_json::Value>,
    updates: Vec<MutationValue>,
) -> Result<crate::db::models::QueryResult, String> {
    let engine = mutation_engine(sqlite_pool.inner(), &uuid).await?;
    let mutation = build_update(
        engine,
        &schema,
        &table,
        &primary_key_columns,
        &primary_key_values,
        &updates,
    )?;
    run_mutation(&pool_manager, sqlite_pool.inner(), &uuid, &mutation).await
}

/// Delete a row from a table using the pooled connection
#[tauri::command]
pub async fn pool_delete_table_row(
    pool_manager: State<'_, Arc<PoolManager>>,
    sqlite_pool: State<'_, SqlitePool>,
    uuid: String,
    schema: String,
    table: String,
    primary_key_columns: Vec<String>,
    primary_key_values: Vec<serde_json::Value>,
) -> Result<crate::db::models::QueryResult, String> {
    let engine = mutation_engine(sqlite_pool.inner(), &uuid).await?;
    let mutation = build_delete(
        engine,
        &schema,
        &table,
        &primary_key_columns,
        &primary_key_values,
    )?;
    run_mutation(&pool_manager, sqlite_pool.inner(), &uuid, &mutation).await
}

/// Insert a new row into a table using the pooled connection
#[tauri::command]
pub async fn pool_insert_table_row(
    pool_manager: State<'_, Arc<PoolManager>>,
    sqlite_pool: State<'_, SqlitePool>,
    uuid: String,
    schema: String,
    table: String,
    values: Vec<MutationValue>,
) -> Result<crate::db::models::QueryResult, String> {
    let engine = mutation_engine(sqlite_pool.inner(), &uuid).await?;
    let mutation = build_insert(engine, &schema, &table, &values)?;
    run_mutation(&pool_manager, sqlite_pool.inner(), &uuid, &mutation).await
}

#[cfg(test)]
mod tests {
    use super::{execute_with_retry_policy, RetryPolicy};
    use std::cell::Cell;

    #[tokio::test]
    async fn never_retry_policy_returns_the_first_error_without_reconnecting() {
        let operation_calls = Cell::new(0);
        let reconnect_calls = Cell::new(0);

        let result: Result<(), String> = execute_with_retry_policy(
            "d1 query",
            RetryPolicy::Never,
            || async {
                operation_calls.set(operation_calls.get() + 1);
                Err("request outcome is unknown".to_string())
            },
            || async {
                reconnect_calls.set(reconnect_calls.get() + 1);
                Ok(())
            },
        )
        .await;

        assert_eq!(result, Err("request outcome is unknown".to_string()));
        assert_eq!(operation_calls.get(), 1);
        assert_eq!(reconnect_calls.get(), 0);
    }

    #[tokio::test]
    async fn reconnect_once_policy_retries_a_safe_read_once() {
        let operation_calls = Cell::new(0);
        let reconnect_calls = Cell::new(0);

        let result = execute_with_retry_policy(
            "safe read",
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
