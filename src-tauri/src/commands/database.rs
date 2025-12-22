//! Unified database commands that dispatch to the correct driver based on db_type.
//!
//! This module provides a single set of Tauri commands that work with PostgreSQL,
//! SQLite, and Redis databases by dispatching to the appropriate driver.

use crate::database::postgres::PostgresDriver;
use crate::database::redis::{RedisDriver, RedisKeyDetails, RedisKeyListResponse};
use crate::database::sqlite::SqliteDriver;
use crate::database::{DatabaseDriver, PostgresConfig, RedisConfig, SqliteConfig};
use crate::db::models::{
    QueryResult, TableDataResponse, TableInfo, TableStructure, TestConnectionResult,
};
use crate::ssh_tunnel::SshTunnel;

/// Creates the appropriate database driver based on the db_type
fn create_driver(
    db_type: &str,
    host: Option<String>,
    port: Option<i64>,
    database: Option<String>,
    username: Option<String>,
    password: Option<String>,
    ssl: Option<bool>,
    file_path: Option<String>,
) -> Result<Box<dyn DatabaseDriver>, String> {
    match db_type {
        "postgres" | "postgresql" => {
            let config = PostgresConfig {
                host: host.unwrap_or_default(),
                port: port.unwrap_or(5432),
                database: database.unwrap_or_default(),
                username: username.unwrap_or_default(),
                password: password.unwrap_or_default(),
                ssl: ssl.unwrap_or(false),
            };
            Ok(Box::new(PostgresDriver::new(config)))
        }
        "sqlite" | "sqlite3" => {
            let path = file_path.ok_or("File path is required for SQLite connections")?;
            let config = SqliteConfig { file_path: path };
            Ok(Box::new(SqliteDriver::new(config)))
        }
        "redis" => {
            let config = RedisConfig {
                host: host.unwrap_or_default(),
                port: port.unwrap_or(6379),
                password,
                db: database.and_then(|d| d.parse().ok()),
            };
            Ok(Box::new(RedisDriver::new(config)))
        }
        _ => Err(format!("Unsupported database type: {}", db_type)),
    }
}

#[tauri::command]
pub async fn unified_test_connection(
    db_type: String,
    host: Option<String>,
    port: Option<i64>,
    database: Option<String>,
    username: Option<String>,
    password: Option<String>,
    ssl: Option<bool>,
    file_path: Option<String>,
) -> Result<TestConnectionResult, String> {
    let driver = create_driver(
        &db_type, host, port, database, username, password, ssl, file_path,
    )?;
    driver.test_connection().await
}

#[tauri::command]
pub async fn unified_list_tables(
    db_type: String,
    host: Option<String>,
    port: Option<i64>,
    database: Option<String>,
    username: Option<String>,
    password: Option<String>,
    ssl: Option<bool>,
    file_path: Option<String>,
) -> Result<Vec<TableInfo>, String> {
    let driver = create_driver(
        &db_type, host, port, database, username, password, ssl, file_path,
    )?;
    driver.list_tables().await
}

#[tauri::command]
pub async fn unified_get_table_data(
    db_type: String,
    host: Option<String>,
    port: Option<i64>,
    database: Option<String>,
    username: Option<String>,
    password: Option<String>,
    ssl: Option<bool>,
    file_path: Option<String>,
    schema: String,
    table: String,
    page: i64,
    limit: i64,
    filter: Option<String>,
) -> Result<TableDataResponse, String> {
    let driver = create_driver(
        &db_type, host, port, database, username, password, ssl, file_path,
    )?;
    driver
        .get_table_data(&schema, &table, page, limit, filter)
        .await
}

#[tauri::command]
pub async fn unified_get_table_structure(
    db_type: String,
    host: Option<String>,
    port: Option<i64>,
    database: Option<String>,
    username: Option<String>,
    password: Option<String>,
    ssl: Option<bool>,
    file_path: Option<String>,
    schema: String,
    table: String,
) -> Result<TableStructure, String> {
    let driver = create_driver(
        &db_type, host, port, database, username, password, ssl, file_path,
    )?;
    driver.get_table_structure(&schema, &table).await
}

#[tauri::command]
pub async fn unified_execute_query(
    db_type: String,
    host: Option<String>,
    port: Option<i64>,
    database: Option<String>,
    username: Option<String>,
    password: Option<String>,
    ssl: Option<bool>,
    file_path: Option<String>,
    query: String,
) -> Result<QueryResult, String> {
    let driver = create_driver(
        &db_type, host, port, database, username, password, ssl, file_path,
    )?;
    driver.execute_query(&query).await
}

// ============================================================================
// Redis-specific commands
// ============================================================================

/// Search for Redis keys matching a pattern
#[tauri::command]
pub async fn redis_search_keys(
    host: String,
    port: i64,
    password: Option<String>,
    db: Option<i64>,
    pattern: String,
    limit: i64,
    ssh_enabled: Option<bool>,
    ssh_host: Option<String>,
    ssh_port: Option<i64>,
    ssh_user: Option<String>,
    ssh_password: Option<String>,
    ssh_key_path: Option<String>,
    ssh_use_key: Option<bool>,
) -> Result<RedisKeyListResponse, String> {
    let config = RedisConfig {
        host,
        port,
        password,
        db,
    };
    let driver = RedisDriver::new(config.clone());

    if ssh_enabled.unwrap_or(false) {
        let ssh_host_val = ssh_host.unwrap_or_default();
        let ssh_port_val = ssh_port.unwrap_or(22) as u16;
        let ssh_user_val = ssh_user.unwrap_or_default();
        let ssh_password_val = ssh_password.unwrap_or_default();
        let ssh_key_path_val = ssh_key_path.unwrap_or_default();
        let ssh_use_key_val = ssh_use_key.unwrap_or(false);

        let (_driver, tunnel) = RedisDriver::with_ssh_tunnel(
            config,
            &ssh_host_val,
            ssh_port_val,
            &ssh_user_val,
            if ssh_password_val.is_empty() { None } else { Some(&ssh_password_val) },
            if ssh_key_path_val.is_empty() { None } else { Some(&ssh_key_path_val) },
            ssh_use_key_val,
        ).await?;

        driver.search_keys_with_tunnel(&tunnel, &pattern, limit).await
    } else {
        driver.search_keys(&pattern, limit).await
    }
}

/// Get detailed information about a specific Redis key
#[tauri::command]
pub async fn redis_get_key_details(
    host: String,
    port: i64,
    password: Option<String>,
    db: Option<i64>,
    key: String,
    ssh_enabled: Option<bool>,
    ssh_host: Option<String>,
    ssh_port: Option<i64>,
    ssh_user: Option<String>,
    ssh_password: Option<String>,
    ssh_key_path: Option<String>,
    ssh_use_key: Option<bool>,
) -> Result<RedisKeyDetails, String> {
    let config = RedisConfig {
        host,
        port,
        password,
        db,
    };
    let driver = RedisDriver::new(config.clone());

    if ssh_enabled.unwrap_or(false) {
        let ssh_host_val = ssh_host.unwrap_or_default();
        let ssh_port_val = ssh_port.unwrap_or(22) as u16;
        let ssh_user_val = ssh_user.unwrap_or_default();
        let ssh_password_val = ssh_password.unwrap_or_default();
        let ssh_key_path_val = ssh_key_path.unwrap_or_default();
        let ssh_use_key_val = ssh_use_key.unwrap_or(false);

        let (_driver, tunnel) = RedisDriver::with_ssh_tunnel(
            config,
            &ssh_host_val,
            ssh_port_val,
            &ssh_user_val,
            if ssh_password_val.is_empty() { None } else { Some(&ssh_password_val) },
            if ssh_key_path_val.is_empty() { None } else { Some(&ssh_key_path_val) },
            ssh_use_key_val,
        ).await?;

        driver.get_key_details_with_tunnel(&tunnel, &key).await
    } else {
        driver.get_key_details(&key).await
    }
}

/// Delete a Redis key
#[tauri::command]
pub async fn redis_delete_key(
    host: String,
    port: i64,
    password: Option<String>,
    db: Option<i64>,
    key: String,
) -> Result<bool, String> {
    let config = RedisConfig {
        host,
        port,
        password,
        db,
    };
    let driver = RedisDriver::new(config);
    driver.delete_key(&key).await
}

/// Set a Redis key value (for string types)
#[tauri::command]
pub async fn redis_set_key(
    host: String,
    port: i64,
    password: Option<String>,
    db: Option<i64>,
    key: String,
    value: String,
    ttl: Option<i64>,
) -> Result<(), String> {
    let config = RedisConfig {
        host,
        port,
        password,
        db,
    };
    let driver = RedisDriver::new(config);
    driver.set_key(&key, &value, ttl).await
}
