//! Unified database commands that dispatch to the correct driver based on db_type.
//!
//! This module provides a single set of Tauri commands that work with both
//! PostgreSQL and SQLite databases by dispatching to the appropriate driver.

use crate::database::postgres::PostgresDriver;
use crate::database::sqlite::SqliteDriver;
use crate::database::{DatabaseDriver, PostgresConfig, SqliteConfig};
use crate::db::models::{
    QueryResult, TableDataResponse, TableInfo, TableStructure, TestConnectionResult,
};

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
