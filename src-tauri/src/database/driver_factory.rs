use super::clickhouse::ClickhouseDriver;
use super::duckdb::DuckDbDriver;
use super::postgres::PostgresDriver;
use super::redis::RedisDriver;
use super::sqlite::SqliteDriver;
use super::{
    ClickhouseConfig, ClickhouseProtocol, DatabaseDriver, DatabaseType, DuckDbConfig,
    PostgresConfig, RedisConfig, SqliteConfig,
};

pub struct DriverConfig {
    pub db_type: String,
    pub host: Option<String>,
    pub port: Option<i64>,
    pub database: Option<String>,
    pub username: Option<String>,
    pub password: Option<String>,
    pub ssl: Option<bool>,
    pub file_path: Option<String>,
}

pub fn create_driver(config: DriverConfig) -> Result<Box<dyn DatabaseDriver>, String> {
    let database_type = DatabaseType::from_str(&config.db_type)
        .ok_or_else(|| format!("Unsupported database type: {}", config.db_type))?;

    match database_type {
        DatabaseType::Postgres => Ok(Box::new(PostgresDriver::new(PostgresConfig {
            host: config.host.unwrap_or_default(),
            port: config.port.unwrap_or(5432),
            database: config.database.unwrap_or_default(),
            username: config.username.unwrap_or_default(),
            password: config.password.unwrap_or_default(),
            ssl: config.ssl.unwrap_or(false),
        }))),
        DatabaseType::Sqlite => {
            let file_path = config
                .file_path
                .ok_or("File path is required for SQLite connections")?;
            Ok(Box::new(SqliteDriver::new(SqliteConfig { file_path })))
        }
        DatabaseType::DuckDb => {
            let file_path = config
                .file_path
                .ok_or("File path is required for DuckDB connections")?;
            Ok(Box::new(DuckDbDriver::new(DuckDbConfig { file_path })))
        }
        DatabaseType::Redis => Ok(Box::new(RedisDriver::new(RedisConfig {
            host: config.host.unwrap_or_default(),
            port: config.port.unwrap_or(6379),
            username: config.username.filter(|username| !username.is_empty()),
            password: config.password,
            db: config.database.and_then(|database| database.parse().ok()),
            tls: config.ssl.unwrap_or(false),
        }))),
        DatabaseType::Clickhouse => Ok(Box::new(ClickhouseDriver::new(ClickhouseConfig {
            host: config.host.unwrap_or_else(|| "localhost".to_string()),
            port: config.port.unwrap_or(8123),
            database: config.database.unwrap_or_else(|| "default".to_string()),
            username: config.username.unwrap_or_else(|| "default".to_string()),
            password: config.password.unwrap_or_default(),
            protocol: ClickhouseProtocol::Http,
            ssl: config.ssl.unwrap_or(false),
        }))),
    }
}

#[cfg(test)]
mod tests {
    use super::{create_driver, DriverConfig};

    fn config(db_type: &str) -> DriverConfig {
        DriverConfig {
            db_type: db_type.to_string(),
            host: None,
            port: None,
            database: None,
            username: None,
            password: None,
            ssl: None,
            file_path: Some("database.db".to_string()),
        }
    }

    #[test]
    fn creates_every_supported_driver_from_one_dispatcher() {
        for db_type in ["postgres", "sqlite", "duckdb", "redis", "clickhouse"] {
            assert!(create_driver(config(db_type)).is_ok(), "{db_type}");
        }
    }

    #[test]
    fn rejects_unknown_database_types() {
        assert_eq!(
            create_driver(config("unknown")).err().unwrap(),
            "Unsupported database type: unknown"
        );
    }
}
