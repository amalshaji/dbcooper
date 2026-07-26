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

/// Disconnect and retry connect (with lock)
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

/// List tables using the pooled connection (auto-connects if needed, auto-retries on error)
#[tauri::command]
pub async fn pool_list_tables(
    pool_manager: State<'_, Arc<PoolManager>>,
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
    ensure_connection(&pool_manager, sqlite_pool.inner(), &uuid).await?;
    let table_filter = crate::db::models::TableFilter::from_parts(filter, structured_filter)?;

    match pool_manager
        .get_table_data(
            &uuid,
            &schema,
            &table,
            page,
            limit,
            table_filter.clone(),
            sort_column.clone(),
            sort_direction.clone(),
        )
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
                .get_table_data(
                    &uuid,
                    &schema,
                    &table,
                    page,
                    limit,
                    table_filter,
                    sort_column,
                    sort_direction,
                )
                .await
        }
    }
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
    pool_manager: State<'_, Arc<PoolManager>>,
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

    match pool_manager
        .get_function_definition(&uuid, &schema, &name, &identity_args)
        .await
    {
        Ok(result) => Ok(result),
        Err(e) => {
            println!(
                "[Pool] get_function_definition failed: {}, retrying with fresh connection",
                e
            );
            reconnect(&pool_manager, sqlite_pool.inner(), &uuid).await?;
            pool_manager
                .get_function_definition(&uuid, &schema, &name, &identity_args)
                .await
        }
    }
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
    match pool_manager.execute_mutation(uuid, mutation).await {
        Ok(result) => Ok(result),
        Err(error) => {
            println!("[Pool] mutation failed: {error}, retrying with fresh connection");
            reconnect(pool_manager, sqlite_pool, uuid).await?;
            pool_manager.execute_mutation(uuid, mutation).await
        }
    }
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
