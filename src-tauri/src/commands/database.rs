//! Unified database commands that dispatch to the correct driver based on db_type.
//!
//! This module provides a single set of Tauri commands that work with PostgreSQL,
//! SQLite, Redis, and ClickHouse databases by dispatching to the appropriate driver.

use crate::database::clickhouse::ClickhouseDriver;
use crate::database::postgres::PostgresDriver;
use crate::database::redis::{RedisDriver, RedisKeyDetails, RedisKeyListResponse};
use crate::database::sqlite::SqliteDriver;
use crate::database::{
    ClickhouseConfig, ClickhouseProtocol, DatabaseDriver, PostgresConfig, RedisConfig, SqliteConfig,
};
use crate::db::models::{
    QueryResult, SchemaOverview, TableDataResponse, TableInfo, TableStructure,
    TestConnectionResult,
};
use crate::ssh_tunnel::SshTunnel;

/// Creates the appropriate database driver based on the db_type, with optional SSH tunnel
async fn create_driver_with_ssh(
    db_type: &str,
    host: Option<String>,
    port: Option<i64>,
    database: Option<String>,
    username: Option<String>,
    password: Option<String>,
    ssl: Option<bool>,
    file_path: Option<String>,
    ssh_enabled: Option<bool>,
    ssh_host: Option<String>,
    ssh_port: Option<i64>,
    ssh_user: Option<String>,
    ssh_password: Option<String>,
    ssh_key_path: Option<String>,
    ssh_use_key: Option<bool>,
) -> Result<(Box<dyn DatabaseDriver>, Option<SshTunnel>), String> {
    let (effective_host, effective_port, tunnel) = if ssh_enabled.unwrap_or(false) {
        let ssh_host_val = ssh_host.unwrap_or_default();
        let ssh_port_val = ssh_port.unwrap_or(22) as u16;
        let ssh_user_val = ssh_user.unwrap_or_default();
        let ssh_password_val = ssh_password.unwrap_or_default();
        let ssh_key_path_val = ssh_key_path.unwrap_or_default();
        let use_key = ssh_use_key.unwrap_or(false);

        let key_path = if use_key && !ssh_key_path_val.is_empty() {
            Some(ssh_key_path_val.as_str())
        } else {
            None
        };
        let password_opt = if !ssh_password_val.is_empty() {
            Some(ssh_password_val.as_str())
        } else {
            None
        };

        let remote_host = host.clone().unwrap_or_default();
        let remote_port = port.unwrap_or(5432) as u16;

        let tunnel = SshTunnel::new(
            &ssh_host_val,
            ssh_port_val,
            &ssh_user_val,
            password_opt,
            key_path,
            &remote_host,
            remote_port,
        )
        .await?;

        (
            "127.0.0.1".to_string(),
            tunnel.local_port as i64,
            Some(tunnel),
        )
    } else {
        (host.clone().unwrap_or_default(), port.unwrap_or(5432), None)
    };

    let driver: Box<dyn DatabaseDriver> = match db_type {
        "postgres" | "postgresql" => {
            let config = PostgresConfig {
                host: effective_host,
                port: effective_port,
                database: database.unwrap_or_default(),
                username: username.unwrap_or_default(),
                password: password.unwrap_or_default(),
                ssl: ssl.unwrap_or(false),
            };
            Box::new(PostgresDriver::new(config))
        }
        "sqlite" | "sqlite3" => {
            let path = file_path.ok_or("File path is required for SQLite connections")?;
            let config = SqliteConfig { file_path: path };
            Box::new(SqliteDriver::new(config))
        }
        "redis" => {
            let config = RedisConfig {
                host: effective_host,
                port: effective_port,
                password,
                db: database.and_then(|d| d.parse().ok()),
                tls: ssl.unwrap_or(false),
            };
            Box::new(RedisDriver::new(config))
        }
        "clickhouse" => {
            let config = ClickhouseConfig {
                host: effective_host,
                port: effective_port,
                database: database.unwrap_or_else(|| "default".to_string()),
                username: username.unwrap_or_else(|| "default".to_string()),
                password: password.unwrap_or_default(),
                protocol: ClickhouseProtocol::Http,
                ssl: ssl.unwrap_or(false),
            };
            Box::new(ClickhouseDriver::new(config))
        }
        _ => return Err(format!("Unsupported database type: {}", db_type)),
    };

    Ok((driver, tunnel))
}

/// Simple driver creation without SSH support (for backwards compatibility)
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
                tls: ssl.unwrap_or(false),
            };
            Ok(Box::new(RedisDriver::new(config)))
        }
        "clickhouse" => {
            let config = ClickhouseConfig {
                host: host.unwrap_or_else(|| "localhost".to_string()),
                port: port.unwrap_or(8123),
                database: database.unwrap_or_else(|| "default".to_string()),
                username: username.unwrap_or_else(|| "default".to_string()),
                password: password.unwrap_or_default(),
                protocol: ClickhouseProtocol::Http,
                ssl: ssl.unwrap_or(false),
            };
            Ok(Box::new(ClickhouseDriver::new(config)))
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

#[tauri::command(rename_all = "snake_case")]
pub async fn unified_list_tables(
    db_type: String,
    host: Option<String>,
    port: Option<i64>,
    database: Option<String>,
    username: Option<String>,
    password: Option<String>,
    ssl: Option<bool>,
    file_path: Option<String>,
    ssh_enabled: Option<bool>,
    ssh_host: Option<String>,
    ssh_port: Option<i64>,
    ssh_user: Option<String>,
    ssh_password: Option<String>,
    ssh_key_path: Option<String>,
    ssh_use_key: Option<bool>,
) -> Result<Vec<TableInfo>, String> {
    let (driver, _tunnel) = create_driver_with_ssh(
        &db_type,
        host,
        port,
        database,
        username,
        password,
        ssl,
        file_path,
        ssh_enabled,
        ssh_host,
        ssh_port,
        ssh_user,
        ssh_password,
        ssh_key_path,
        ssh_use_key,
    )
    .await?;
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
// Row editing commands (UPDATE/DELETE)
// ============================================================================

/// Update a row in a table
#[tauri::command]
pub async fn update_table_row(
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
    primary_key_columns: Vec<String>,
    primary_key_values: Vec<serde_json::Value>,
    updates: serde_json::Map<String, serde_json::Value>,
) -> Result<QueryResult, String> {
    if primary_key_columns.is_empty() || primary_key_columns.len() != primary_key_values.len() {
        return Err("Primary key columns and values must match".to_string());
    }

    if updates.is_empty() {
        return Err("No updates provided".to_string());
    }

    let driver = create_driver(
        &db_type, host, port, database, username, password, ssl, file_path,
    )?;

    // Build the UPDATE query
    let table_ref = if db_type == "sqlite" || db_type == "sqlite3" {
        format!("\"{}\"", table)
    } else {
        format!("\"{}\".\"{}\"", schema, table)
    };

    // Build SET clause
    let set_parts: Vec<String> = updates
        .iter()
        .map(|(col, val)| {
            let formatted_value = format_sql_value(val);
            format!("\"{}\" = {}", col, formatted_value)
        })
        .collect();
    let set_clause = set_parts.join(", ");

    // Build WHERE clause for primary key
    let where_parts: Vec<String> = primary_key_columns
        .iter()
        .zip(primary_key_values.iter())
        .map(|(col, val)| {
            let formatted_value = format_sql_value(val);
            format!("\"{}\" = {}", col, formatted_value)
        })
        .collect();
    let where_clause = where_parts.join(" AND ");

    let query = format!(
        "UPDATE {} SET {} WHERE {}",
        table_ref, set_clause, where_clause
    );

    driver.execute_query(&query).await
}

/// Delete a row from a table
#[tauri::command]
pub async fn delete_table_row(
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
    primary_key_columns: Vec<String>,
    primary_key_values: Vec<serde_json::Value>,
) -> Result<QueryResult, String> {
    if primary_key_columns.is_empty() || primary_key_columns.len() != primary_key_values.len() {
        return Err("Primary key columns and values must match".to_string());
    }

    let driver = create_driver(
        &db_type, host, port, database, username, password, ssl, file_path,
    )?;

    // Build the DELETE query
    let table_ref = if db_type == "sqlite" || db_type == "sqlite3" {
        format!("\"{}\"", table)
    } else {
        format!("\"{}\".\"{}\"", schema, table)
    };

    // Build WHERE clause for primary key
    let where_parts: Vec<String> = primary_key_columns
        .iter()
        .zip(primary_key_values.iter())
        .map(|(col, val)| {
            let formatted_value = format_sql_value(val);
            format!("\"{}\" = {}", col, formatted_value)
        })
        .collect();
    let where_clause = where_parts.join(" AND ");

    let query = format!("DELETE FROM {} WHERE {}", table_ref, where_clause);

    driver.execute_query(&query).await
}

/// Format a JSON value for SQL insertion
fn format_sql_value(value: &serde_json::Value) -> String {
    match value {
        serde_json::Value::Null => "NULL".to_string(),
        serde_json::Value::Bool(b) => {
            if *b {
                "TRUE".to_string()
            } else {
                "FALSE".to_string()
            }
        }
        serde_json::Value::Number(n) => n.to_string(),
        serde_json::Value::String(s) => {
            // Escape single quotes by doubling them
            let escaped = s.replace('\'', "''");
            format!("'{}'", escaped)
        }
        serde_json::Value::Array(arr) => {
            // For arrays, convert to JSON string
            let json_str = serde_json::to_string(arr).unwrap_or_default();
            let escaped = json_str.replace('\'', "''");
            format!("'{}'", escaped)
        }
        serde_json::Value::Object(obj) => {
            // For objects, convert to JSON string
            let json_str = serde_json::to_string(obj).unwrap_or_default();
            let escaped = json_str.replace('\'', "''");
            format!("'{}'", escaped)
        }
    }
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
        tls: false,
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
            if ssh_password_val.is_empty() {
                None
            } else {
                Some(&ssh_password_val)
            },
            if ssh_key_path_val.is_empty() {
                None
            } else {
                Some(&ssh_key_path_val)
            },
            ssh_use_key_val,
        )
        .await?;

        driver
            .search_keys_with_tunnel(&tunnel, &pattern, limit)
            .await
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
        tls: false,
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
            if ssh_password_val.is_empty() {
                None
            } else {
                Some(&ssh_password_val)
            },
            if ssh_key_path_val.is_empty() {
                None
            } else {
                Some(&ssh_key_path_val)
            },
            ssh_use_key_val,
        )
        .await?;

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
        tls: false,
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
        tls: false,
    };
    let driver = RedisDriver::new(config);
    driver.set_key(&key, &value, ttl).await
}

/// Get schema overview with all tables and their structures
#[tauri::command(rename_all = "snake_case")]
pub async fn unified_get_schema_overview(
    db_type: String,
    host: Option<String>,
    port: Option<i64>,
    database: Option<String>,
    username: Option<String>,
    password: Option<String>,
    ssl: Option<bool>,
    file_path: Option<String>,
    ssh_enabled: Option<bool>,
    ssh_host: Option<String>,
    ssh_port: Option<i64>,
    ssh_user: Option<String>,
    ssh_password: Option<String>,
    ssh_key_path: Option<String>,
    ssh_use_key: Option<bool>,
) -> Result<SchemaOverview, String> {
    let (driver, _tunnel) = create_driver_with_ssh(
        &db_type,
        host,
        port,
        database,
        username,
        password,
        ssl,
        file_path,
        ssh_enabled,
        ssh_host,
        ssh_port,
        ssh_user,
        ssh_password,
        ssh_key_path,
        ssh_use_key,
    )
    .await?;

    driver.get_schema_overview().await
}
