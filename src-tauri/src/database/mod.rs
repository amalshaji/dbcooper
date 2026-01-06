use async_trait::async_trait;

pub mod clickhouse;
pub mod pool_manager;
pub mod postgres;
pub mod queries;
pub mod redis;
pub mod sqlite;

use crate::db::models::{
    QueryResult, SchemaOverview, TableDataResponse, TableInfo, TableStructure,
    TestConnectionResult,
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
        sort_column: Option<String>,
        sort_direction: Option<String>,
    ) -> Result<TableDataResponse, String>;

    /// Get the structure of a table (columns, indexes, foreign keys)
    async fn get_table_structure(
        &self,
        schema: &str,
        table: &str,
    ) -> Result<TableStructure, String>;

    /// Execute a raw SQL query
    async fn execute_query(&self, query: &str) -> Result<QueryResult, String>;

    /// Get schema overview with all tables and their structures (columns, foreign keys, indexes)
    async fn get_schema_overview(&self) -> Result<SchemaOverview, String>;
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
    pub tls: bool,
}

// Re-export ClickHouse config from its module
pub use clickhouse::{ClickhouseConfig, ClickhouseProtocol};

/// Database type enum for dispatching
#[allow(dead_code)]
#[derive(Clone, Debug, PartialEq)]
pub enum DatabaseType {
    Postgres,
    Sqlite,
    Redis,
    Clickhouse,
}

impl DatabaseType {
    #[allow(dead_code)]
    pub fn from_str(s: &str) -> Option<Self> {
        match s.to_lowercase().as_str() {
            "postgres" | "postgresql" => Some(DatabaseType::Postgres),
            "sqlite" | "sqlite3" => Some(DatabaseType::Sqlite),
            "redis" => Some(DatabaseType::Redis),
            "clickhouse" => Some(DatabaseType::Clickhouse),
            _ => None,
        }
    }
}
