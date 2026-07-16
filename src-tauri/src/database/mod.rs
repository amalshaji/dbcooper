use async_trait::async_trait;

pub mod clickhouse;
pub mod filter;
pub mod pool_manager;
pub mod postgres;
pub mod queries;
pub mod redis;
pub mod sqlite;

use crate::db::models::{
    FunctionDefinition, QueryResult, SchemaOverview, TableDataResponse, TableInfo, TableStructure,
    TestConnectionResult,
};

pub const MAX_QUERY_RESULT_ROWS: usize = 10_000;

fn is_identifier_char(ch: char) -> bool {
    ch.is_ascii_alphanumeric() || ch == '_'
}

fn starts_with_keyword(sql: &str, keyword: &str) -> bool {
    sql.get(..keyword.len())
        .is_some_and(|prefix| prefix.eq_ignore_ascii_case(keyword))
        && sql[keyword.len()..]
            .chars()
            .next()
            .map_or(true, |ch| !is_identifier_char(ch))
}

fn strip_leading_sql_comments(mut sql: &str) -> &str {
    loop {
        sql = sql.trim_start();

        if let Some(rest) = sql.strip_prefix("--") {
            if let Some(newline_index) = rest.find('\n') {
                sql = &rest[newline_index + 1..];
                continue;
            }
            return "";
        }

        if let Some(rest) = sql.strip_prefix("/*") {
            if let Some(end_index) = rest.find("*/") {
                sql = &rest[end_index + 2..];
                continue;
            }
            return "";
        }

        return sql;
    }
}

fn contains_keyword_outside_literals(sql: &str, keyword: &str) -> bool {
    let mut chars = sql.char_indices().peekable();
    let mut in_single_quote = false;
    let mut in_double_quote = false;
    let mut in_line_comment = false;
    let mut in_block_comment = false;

    while let Some((index, ch)) = chars.next() {
        let next = chars.peek().map(|(_, next_ch)| *next_ch);

        if in_line_comment {
            if ch == '\n' {
                in_line_comment = false;
            }
            continue;
        }

        if in_block_comment {
            if ch == '*' && next == Some('/') {
                chars.next();
                in_block_comment = false;
            }
            continue;
        }

        if in_single_quote {
            if ch == '\'' {
                if next == Some('\'') {
                    chars.next();
                } else {
                    in_single_quote = false;
                }
            }
            continue;
        }

        if in_double_quote {
            if ch == '"' {
                if next == Some('"') {
                    chars.next();
                } else {
                    in_double_quote = false;
                }
            }
            continue;
        }

        if ch == '-' && next == Some('-') {
            chars.next();
            in_line_comment = true;
            continue;
        }

        if ch == '/' && next == Some('*') {
            chars.next();
            in_block_comment = true;
            continue;
        }

        if ch == '\'' {
            in_single_quote = true;
            continue;
        }

        if ch == '"' {
            in_double_quote = true;
            continue;
        }

        let end = index + keyword.len();
        if sql
            .get(index..end)
            .is_some_and(|candidate| candidate.eq_ignore_ascii_case(keyword))
        {
            let prev_is_boundary = sql[..index]
                .chars()
                .next_back()
                .map_or(true, |prev| !is_identifier_char(prev));
            let next_is_boundary = sql[end..]
                .chars()
                .next()
                .map_or(true, |next_ch| !is_identifier_char(next_ch));

            if prev_is_boundary && next_is_boundary {
                return true;
            }
        }
    }

    false
}

pub fn query_returns_rows(query: &str) -> bool {
    let sql = strip_leading_sql_comments(query);

    if [
        "SELECT", "WITH", "VALUES", "SHOW", "DESCRIBE", "PRAGMA", "EXPLAIN",
    ]
    .iter()
    .any(|keyword| starts_with_keyword(sql, keyword))
    {
        return true;
    }

    ["INSERT", "UPDATE", "DELETE", "MERGE"]
        .iter()
        .any(|keyword| starts_with_keyword(sql, keyword))
        && contains_keyword_outside_literals(sql, "RETURNING")
}

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
        structured_filter: Option<crate::db::models::FilterExpression>,
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

    /// Get a function definition by fully qualified identity signature.
    async fn get_function_definition(
        &self,
        _schema: &str,
        _name: &str,
        _identity_args: &str,
    ) -> Result<FunctionDefinition, String> {
        Err("Function definitions are not supported for this database".to_string())
    }
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
    pub username: Option<String>,
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
