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
    QueryResult, SchemaOverview, TableDataResponse, TableInfo, TableStructure, TestConnectionResult,
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

        // Use a 20 second timeout for SSH tunnel creation (can take longer due to network/auth)
        let tunnel = match tokio::time::timeout(
            std::time::Duration::from_secs(20),
            SshTunnel::new(
                &ssh_host_val,
                ssh_port_val,
                &ssh_user_val,
                password_opt,
                key_path,
                &remote_host,
                remote_port,
            ),
        )
        .await
        {
            Ok(Ok(tunnel)) => tunnel,
            Ok(Err(e)) => return Err(format!("SSH tunnel failed: {}", e)),
            Err(_) => return Err("SSH tunnel connection timed out after 20 seconds".to_string()),
        };

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
        format!("\"{}\"", escape_sql_identifier(&table))
    } else {
        format!(
            "\"{}\".\"{}\"",
            escape_sql_identifier(&schema),
            escape_sql_identifier(&table)
        )
    };

    // Build SET clause
    let set_parts: Vec<String> = updates
        .iter()
        .map(|(col, val)| {
            let formatted_value = format_sql_value(val);
            format!("\"{}\" = {}", escape_sql_identifier(col), formatted_value)
        })
        .collect();
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

    driver.execute_query(&query).await
}

/// Update a row in a table with raw SQL support
#[tauri::command]
pub async fn update_table_row_with_raw_sql(
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
    updates: Vec<serde_json::Value>,
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
            // For raw SQL (functions), validate against whitelist first
            let raw_value = value.as_str().ok_or("Raw SQL value must be a string")?;

            // Validate the raw SQL value against whitelist
            validate_raw_sql_value(raw_value, &db_type)
                .map_err(|e| format!("Invalid raw SQL value: {}", e))?;

            // Use the value as-is after validation
            raw_value.to_string()
        } else {
            // For literal values, format them properly
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

    driver.execute_query(&query).await
}

/// Insert a new row into a table
#[tauri::command]
pub async fn insert_table_row(
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
    values: Vec<serde_json::Value>,
) -> Result<QueryResult, String> {
    if values.is_empty() {
        return Err("No values provided".to_string());
    }

    let driver = create_driver(
        &db_type, host, port, database, username, password, ssl, file_path,
    )?;

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
    // Each value should be an object with: column, value, isRawSql
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
            // For raw SQL (functions), validate against whitelist first
            let raw_value = value.as_str().ok_or("Raw SQL value must be a string")?;

            // Validate the raw SQL value against whitelist
            validate_raw_sql_value(raw_value, &db_type)
                .map_err(|e| format!("Invalid raw SQL value: {}", e))?;

            // Use the value as-is after validation
            raw_value.to_string()
        } else {
            // For literal values, format them properly
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

    driver.execute_query(&query).await
}

/// Whitelist of allowed SQL functions/values for raw SQL injection.
/// This prevents SQL injection by only allowing known safe SQL functions.
/// Must match the frontend whitelist in src/lib/sqlFunctions.ts
pub fn get_allowed_sql_functions() -> std::collections::HashSet<&'static str> {
    [
        // PostgreSQL functions
        "now()",
        "current_timestamp",
        "localtimestamp",
        "current_date",
        "now()::date",
        "current_time",
        "localtime",
        "gen_random_uuid()",
        "uuid_generate_v4()",
        "DEFAULT",
        "TRUE",
        "FALSE",
        "'{}'::json",
        "'[]'::json",
        "'{}'::jsonb",
        "'[]'::jsonb",
        // SQLite functions
        "datetime('now')",
        "datetime('now', 'localtime')",
        "date('now')",
        "date('now', 'localtime')",
        "time('now')",
        "time('now', 'localtime')",
        "NULL",
        "1",
        "0",
        // ClickHouse functions
        "now64()",
        "today()",
        "yesterday()",
        "generateUUIDv4()",
        "true",
        "false",
        "'{}'",
    ]
    .iter()
    .cloned()
    .collect()
}

/// Validate that a raw SQL value is in the whitelist of allowed functions.
/// This prevents SQL injection by only allowing known safe SQL functions.
/// Returns Ok(()) if valid, Err(String) if invalid.
pub fn validate_raw_sql_value(value: &str, _db_type: &str) -> Result<(), String> {
    let trimmed = value.trim();

    // Empty string is not allowed for raw SQL
    if trimmed.is_empty() {
        return Err("Raw SQL value cannot be empty".to_string());
    }

    let allowed = get_allowed_sql_functions();

    // Check exact match first (case-sensitive)
    if allowed.contains(trimmed) {
        return Ok(());
    }

    // For case-insensitive matching (some databases are case-insensitive)
    // But only for specific values that are safe to match case-insensitively
    let trimmed_lower = trimmed.to_lowercase();
    let case_insensitive_allowed = [
        "true",
        "false",
        "null",
        "default",
        "now()",
        "current_timestamp",
        "localtimestamp",
        "current_date",
        "current_time",
        "localtime",
        "gen_random_uuid()",
        "uuid_generate_v4()",
        "datetime('now')",
        "datetime('now', 'localtime')",
        "date('now')",
        "date('now', 'localtime')",
        "time('now')",
        "time('now', 'localtime')",
        "now64()",
        "today()",
        "yesterday()",
        "generateuuidv4()",
    ];

    for allowed_func in case_insensitive_allowed.iter() {
        if trimmed_lower == *allowed_func {
            return Ok(());
        }
    }

    // Additional security check: reject anything with SQL keywords that could be used for injection
    // This is a defense-in-depth measure even if the value doesn't match the whitelist
    let dangerous_patterns = [
        "drop",
        "delete",
        "truncate",
        "alter",
        "create",
        "insert",
        "update",
        "exec",
        "execute",
        "union",
        "select",
        "from",
        "where",
        "having",
        "grant",
        "revoke",
        "commit",
        "rollback",
        "begin",
        "transaction",
        ";",
        "--",
        "/*",
        "*/",
        "xp_",
        "sp_",
        "script",
        "javascript",
    ];

    let value_lower = trimmed_lower.as_str();
    for pattern in dangerous_patterns.iter() {
        if value_lower.contains(pattern) {
            return Err(format!(
                "Raw SQL value contains potentially dangerous pattern: '{}'. Only whitelisted SQL functions are allowed.",
                pattern
            ));
        }
    }

    // If it doesn't match the whitelist, reject it to be safe
    // This is the primary security check - whitelist-only approach
    Err(format!(
        "Raw SQL value '{}' is not in the whitelist of allowed functions. Only predefined SQL functions are allowed for security.",
        trimmed
    ))
}

/// Escape a SQL identifier (table name, column name, schema name) by doubling any double quotes.
/// This prevents SQL injection through malicious identifiers like: column" OR 1=1 --
pub fn escape_sql_identifier(identifier: &str) -> String {
    identifier.replace('"', "\"\"")
}

/// Format a JSON value for SQL insertion
pub fn format_sql_value(value: &serde_json::Value) -> String {
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
