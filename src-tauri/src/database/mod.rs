use async_trait::async_trait;

pub mod postgres;
pub mod redis;
pub mod sqlite;

use crate::db::models::{
    QueryResult, TableDataResponse, TableInfo, TableStructure, TestConnectionResult,
};

/// Common trait for all database drivers
#[async_trait]
pub trait DatabaseDriver: Send + Sync {
    /// Test if the connection is valid
    async fn test_connection(&self) -> Result<TestConnectionResult, String>;

    /// List all tables in the database
    async fn list_tables(&self) -> Result<Vec<TableInfo>, String>;

    /// Get paginated data from a table
    async fn get_table_data(
        &self,
        schema: &str,
        table: &str,
        page: i64,
        limit: i64,
        filter: Option<String>,
    ) -> Result<TableDataResponse, String>;

    /// Get the structure of a table (columns, indexes, foreign keys)
    async fn get_table_structure(
        &self,
        schema: &str,
        table: &str,
    ) -> Result<TableStructure, String>;

    /// Execute a raw SQL query
    async fn execute_query(&self, query: &str) -> Result<QueryResult, String>;
}

/// Configuration for Postgres connections
#[derive(Clone)]
pub struct PostgresConfig {
    pub host: String,
    pub port: i64,
    pub database: String,
    pub username: String,
    pub password: String,
    pub ssl: bool,
}

/// Configuration for SQLite connections
#[derive(Clone)]
pub struct SqliteConfig {
    pub file_path: String,
}

/// Configuration for Redis connections
#[derive(Clone)]
pub struct RedisConfig {
    pub host: String,
    pub port: i64,
    pub password: Option<String>,
    pub db: Option<i64>,
}

/// Database type enum for dispatching
#[derive(Clone, Debug, PartialEq)]
pub enum DatabaseType {
    Postgres,
    Sqlite,
    Redis,
}

impl DatabaseType {
    pub fn from_str(s: &str) -> Option<Self> {
        match s.to_lowercase().as_str() {
            "postgres" | "postgresql" => Some(DatabaseType::Postgres),
            "sqlite" | "sqlite3" => Some(DatabaseType::Sqlite),
            "redis" => Some(DatabaseType::Redis),
            _ => None,
        }
    }
}
