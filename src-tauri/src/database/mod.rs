use async_trait::async_trait;

pub mod clickhouse;
pub mod create_table;
pub mod driver_factory;
pub mod duckdb;
pub mod filter;
pub mod mutation;
pub mod mysql;
mod mysql_read_only;
pub mod pool_manager;
pub mod postgres;
pub mod queries;
pub mod redis;
pub mod redis_read_only;
pub mod sql_policy;
pub mod sqlite;
pub mod utils;

use crate::db::models::{
    CreateTableRequest, FunctionDefinition, QueryResult, SchemaOverview, TableDataResponse,
    TableFilter, TableInfo, TableStructure, TestConnectionResult,
};
use mutation::MutationPlan;

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
    let mut in_backtick = false;
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

        if in_backtick {
            if ch == '`' {
                if next == Some('`') {
                    chars.next();
                } else {
                    in_backtick = false;
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

        if ch == '`' {
            in_backtick = true;
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

pub(crate) fn sqlite_read_only_query_is_safe(sql: &str) -> bool {
    !contains_keyword_outside_literals(sql, "ATTACH")
        && !contains_keyword_outside_literals(sql, "DETACH")
}

pub(crate) fn query_returns_rows_with_keywords(query: &str, extra_keywords: &[&str]) -> bool {
    let sql = strip_leading_sql_comments(query);

    if [
        "SELECT", "WITH", "VALUES", "SHOW", "DESCRIBE", "DESC", "PRAGMA", "EXPLAIN",
    ]
    .iter()
    .chain(extra_keywords.iter())
    .any(|keyword| starts_with_keyword(sql, keyword))
    {
        return true;
    }

    ["INSERT", "UPDATE", "DELETE", "MERGE"]
        .iter()
        .any(|keyword| starts_with_keyword(sql, keyword))
        && contains_keyword_outside_literals(sql, "RETURNING")
}

pub fn query_returns_rows(query: &str) -> bool {
    query_returns_rows_with_keywords(query, &[])
}

/// Common trait for all database drivers
#[async_trait]
pub trait DatabaseDriver: Send + Sync {
    /// Test if the connection is valid
    async fn test_connection(&self) -> Result<TestConnectionResult, String>;

    /// List all tables in the database
    async fn list_tables(&self) -> Result<Vec<TableInfo>, String>;

    /// Build the exact CREATE TABLE statement without executing it.
    fn preview_create_table(&self, _request: &CreateTableRequest) -> Result<String, String> {
        Err("Creating tables is not supported for this database".to_string())
    }

    /// Create a table exactly once.
    async fn create_table(&self, _request: &CreateTableRequest) -> Result<TableInfo, String> {
        Err("Creating tables is not supported for this database".to_string())
    }

    /// Get paginated data from a table
    async fn get_table_data(
        &self,
        schema: &str,
        table: &str,
        page: i64,
        limit: i64,
        filter: Option<TableFilter>,
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

    async fn execute_mutation(&self, mutation: &MutationPlan) -> Result<QueryResult, String> {
        if !mutation.values.is_empty() {
            return Err("Bound mutations are not supported for this database".to_string());
        }
        self.execute_query(&mutation.sql).await
    }

    /// Execute a query under read-only enforcement.
    ///
    /// Enforcement is done by the database engine wherever possible (read-only
    /// transactions, connection flags, server settings) rather than by parsing
    /// the query string, so writes disguised inside CTEs, `EXPLAIN ANALYZE`,
    /// mutating pragmas, etc. are rejected by the engine itself. Drivers that
    /// cannot get an engine-level guarantee (e.g. Redis) fall back to a
    /// best-effort, subcommand-aware allowlist.
    async fn execute_query_read_only(&self, query: &str) -> Result<QueryResult, String>;

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

#[derive(Clone)]
pub struct MysqlConfig {
    pub flavor: MysqlFlavor,
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

#[derive(Clone)]
pub struct DuckDbConfig {
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
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum DatabaseType {
    Postgres,
    Mysql,
    Mariadb,
    Sqlite,
    DuckDb,
    Redis,
    Clickhouse,
}

impl DatabaseType {
    pub fn as_str(self) -> &'static str {
        match self {
            Self::Postgres => "postgres",
            Self::Mysql => "mysql",
            Self::Mariadb => "mariadb",
            Self::Sqlite => "sqlite",
            Self::DuckDb => "duckdb",
            Self::Redis => "redis",
            Self::Clickhouse => "clickhouse",
        }
    }

    pub fn default_port(self) -> i64 {
        match self {
            Self::Postgres | Self::Sqlite | Self::DuckDb => 5432,
            Self::Mysql | Self::Mariadb => 3306,
            Self::Redis => 6379,
            Self::Clickhouse => 8123,
        }
    }
}

impl TryFrom<&str> for DatabaseType {
    type Error = String;

    fn try_from(value: &str) -> Result<Self, Self::Error> {
        match value.to_ascii_lowercase().as_str() {
            "postgres" | "postgresql" => Ok(Self::Postgres),
            "mysql" => Ok(Self::Mysql),
            "mariadb" => Ok(Self::Mariadb),
            "sqlite" | "sqlite3" => Ok(Self::Sqlite),
            "duckdb" => Ok(Self::DuckDb),
            "redis" => Ok(Self::Redis),
            "clickhouse" => Ok(Self::Clickhouse),
            _ => Err(format!("Unsupported database type: {value}")),
        }
    }
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum MysqlFlavor {
    Mysql,
    Mariadb,
}

impl TryFrom<DatabaseType> for MysqlFlavor {
    type Error = String;

    fn try_from(value: DatabaseType) -> Result<Self, Self::Error> {
        match value {
            DatabaseType::Mysql => Ok(Self::Mysql),
            DatabaseType::Mariadb => Ok(Self::Mariadb),
            _ => Err("MySQL configuration requires a MySQL or MariaDB engine".to_string()),
        }
    }
}

#[cfg(test)]
mod database_type_tests {
    use super::{DatabaseType, MysqlFlavor};

    #[test]
    fn parses_aliases_and_owns_default_ports() {
        assert_eq!(
            DatabaseType::try_from("postgresql"),
            Ok(DatabaseType::Postgres)
        );
        assert_eq!(DatabaseType::try_from("mysql"), Ok(DatabaseType::Mysql));
        assert_eq!(DatabaseType::Mysql.default_port(), 3306);
        assert_eq!(DatabaseType::Mariadb.default_port(), 3306);
        assert_eq!(DatabaseType::Redis.default_port(), 6379);
        assert_eq!(DatabaseType::Clickhouse.default_port(), 8123);
    }

    #[test]
    fn mysql_flavor_rejects_unrelated_engines() {
        assert_eq!(
            MysqlFlavor::try_from(DatabaseType::Mysql),
            Ok(MysqlFlavor::Mysql)
        );
        assert_eq!(
            MysqlFlavor::try_from(DatabaseType::Mariadb),
            Ok(MysqlFlavor::Mariadb)
        );
        assert!(MysqlFlavor::try_from(DatabaseType::Postgres).is_err());
    }
}

#[cfg(test)]
mod mysql_read_only_tests {
    use super::{mysql_read_only_query_is_safe, query_returns_rows};

    #[test]
    fn accepts_reads_and_rejects_mutating_or_multi_statement_queries() {
        assert!(mysql_read_only_query_is_safe("SELECT * FROM `update`"));
        assert!(mysql_read_only_query_is_safe(
            "WITH ids AS (SELECT 1) SELECT * FROM ids"
        ));
        assert!(mysql_read_only_query_is_safe("SHOW TABLES;"));
        assert!(mysql_read_only_query_is_safe("SELECT ';' AS value"));
        assert!(!mysql_read_only_query_is_safe("SELECT 1; DROP TABLE users"));
        assert!(!mysql_read_only_query_is_safe(
            "WITH changed AS (UPDATE users SET name = 'x') SELECT * FROM changed"
        ));
        assert!(!mysql_read_only_query_is_safe(
            "SELECT * FROM users INTO OUTFILE '/tmp/users'"
        ));
        assert!(!mysql_read_only_query_is_safe(
            "SELECT 1 /*!50000 INTO OUTFILE '/tmp/value' */"
        ));
    }

    #[test]
    fn treats_mysql_desc_as_a_row_returning_query() {
        assert!(query_returns_rows("DESC users"));
    }
}
