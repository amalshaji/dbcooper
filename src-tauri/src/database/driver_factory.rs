use super::clickhouse::ClickhouseDriver;
use super::d1::D1Driver;
use super::duckdb::DuckDbDriver;
use super::mysql::MysqlDriver;
use super::postgres::PostgresDriver;
use super::redis::RedisDriver;
use super::sqlite::SqliteDriver;
use super::{
    ClickhouseConfig, ClickhouseProtocol, D1Config, DatabaseDriver, DatabaseType, DuckDbConfig,
    MysqlConfig, MysqlFlavor, PostgresConfig, RedisConfig, SqliteConfig,
};
use crate::ssh_tunnel::{SshAuth, SshTunnel};

#[derive(Clone, Debug)]
pub struct DriverConfig {
    pub db_type: String,
    pub host: Option<String>,
    pub port: Option<i64>,
    pub database: Option<String>,
    pub username: Option<String>,
    pub password: Option<String>,
    pub ssl: Option<bool>,
    pub file_path: Option<String>,
    pub ssh_enabled: bool,
    pub ssh_host: Option<String>,
    pub ssh_port: Option<i64>,
    pub ssh_user: Option<String>,
    pub ssh_password: Option<String>,
    pub ssh_key_path: Option<String>,
    pub ssh_use_key: bool,
}

impl DriverConfig {
    fn engine(&self) -> Result<DatabaseType, String> {
        DatabaseType::try_from(self.db_type.as_str())
    }
}

pub fn create_driver(config: &DriverConfig) -> Result<Box<dyn DatabaseDriver>, String> {
    let engine = config.engine()?;
    let host = config.host.clone().unwrap_or_else(|| {
        if engine == DatabaseType::Clickhouse {
            "localhost".to_string()
        } else {
            String::new()
        }
    });
    let port = config.port.unwrap_or_else(|| engine.default_port());
    build_driver(engine, config, host, port)
}

pub async fn create_driver_with_ssh(
    config: &DriverConfig,
) -> Result<(Box<dyn DatabaseDriver>, Option<SshTunnel>), String> {
    let engine = config.engine()?;
    if engine == DatabaseType::D1 && config.ssh_enabled {
        return Err("SSH tunnels are not supported for Cloudflare D1".to_string());
    }
    let ssh_enabled =
        config.ssh_enabled && !matches!(engine, DatabaseType::Sqlite | DatabaseType::DuckDb);
    let (host, port, tunnel) = if ssh_enabled {
        let ssh_host = config.ssh_host.as_deref().ok_or("SSH host is required")?;
        let ssh_port = config.ssh_port.unwrap_or(22) as u16;
        let ssh_user = config.ssh_user.as_deref().ok_or("SSH user is required")?;
        let auth = SshAuth::from_connection(
            config.ssh_use_key,
            config.ssh_password.as_deref(),
            config.ssh_key_path.as_deref(),
        );
        let remote_host = config.host.as_deref().ok_or("Remote host is required")?;
        let remote_port = config.port.unwrap_or_else(|| engine.default_port()) as u16;
        let tunnel = tokio::time::timeout(
            std::time::Duration::from_secs(20),
            SshTunnel::new(ssh_host, ssh_port, ssh_user, auth, remote_host, remote_port),
        )
        .await
        .map_err(|_| "SSH tunnel connection timed out after 20 seconds".to_string())?
        .map_err(|error| format!("SSH tunnel failed: {error}"))?;

        (
            "127.0.0.1".to_string(),
            tunnel.local_port as i64,
            Some(tunnel),
        )
    } else {
        (
            config.host.clone().unwrap_or_default(),
            config.port.unwrap_or_else(|| engine.default_port()),
            None,
        )
    };

    Ok((build_driver(engine, config, host, port)?, tunnel))
}

fn build_driver(
    engine: DatabaseType,
    config: &DriverConfig,
    host: String,
    port: i64,
) -> Result<Box<dyn DatabaseDriver>, String> {
    match engine {
        DatabaseType::Postgres => Ok(Box::new(PostgresDriver::new(PostgresConfig {
            host,
            port,
            database: config.database.clone().unwrap_or_default(),
            username: config.username.clone().unwrap_or_default(),
            password: config.password.clone().unwrap_or_default(),
            ssl: config.ssl.unwrap_or(false),
        }))),
        DatabaseType::Mysql | DatabaseType::Mariadb => {
            Ok(Box::new(MysqlDriver::new(MysqlConfig {
                flavor: MysqlFlavor::try_from(engine)?,
                host,
                port,
                database: config.database.clone().unwrap_or_default(),
                username: config.username.clone().unwrap_or_default(),
                password: config.password.clone().unwrap_or_default(),
                ssl: config.ssl.unwrap_or(false),
            })))
        }
        DatabaseType::Sqlite => {
            let file_path = config
                .file_path
                .clone()
                .ok_or("File path is required for SQLite connections")?;
            Ok(Box::new(SqliteDriver::new(SqliteConfig { file_path })))
        }
        DatabaseType::DuckDb => {
            let file_path = config
                .file_path
                .clone()
                .ok_or("File path is required for DuckDB connections")?;
            Ok(Box::new(DuckDbDriver::new(DuckDbConfig { file_path })))
        }
        DatabaseType::Redis => Ok(Box::new(RedisDriver::new(RedisConfig {
            host,
            port,
            username: config
                .username
                .clone()
                .filter(|username| !username.is_empty()),
            password: config.password.clone(),
            db: config.database.clone().and_then(|value| value.parse().ok()),
            tls: config.ssl.unwrap_or(false),
        }))),
        DatabaseType::Clickhouse => Ok(Box::new(ClickhouseDriver::new(ClickhouseConfig {
            host,
            port,
            database: config
                .database
                .clone()
                .unwrap_or_else(|| "default".to_string()),
            username: config
                .username
                .clone()
                .unwrap_or_else(|| "default".to_string()),
            password: config.password.clone().unwrap_or_default(),
            protocol: ClickhouseProtocol::Http,
            ssl: config.ssl.unwrap_or(false),
        }))),
        DatabaseType::D1 => Ok(Box::new(D1Driver::new(D1Config {
            account_id: config.username.clone().unwrap_or_default(),
            database_id: config.database.clone().unwrap_or_default(),
            api_token: config.password.clone().unwrap_or_default(),
        }))),
    }
}

#[cfg(test)]
mod tests {
    use super::{create_driver, create_driver_with_ssh, DriverConfig};

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
            ssh_enabled: false,
            ssh_host: None,
            ssh_port: None,
            ssh_user: None,
            ssh_password: None,
            ssh_key_path: None,
            ssh_use_key: false,
        }
    }

    #[test]
    fn creates_every_supported_driver_from_one_dispatcher() {
        for db_type in [
            "postgres",
            "mysql",
            "mariadb",
            "sqlite",
            "duckdb",
            "redis",
            "clickhouse",
            "d1",
        ] {
            assert!(create_driver(&config(db_type)).is_ok(), "{db_type}");
        }
    }

    #[test]
    fn rejects_unknown_database_types() {
        assert_eq!(
            create_driver(&config("unknown")).err().unwrap(),
            "Unsupported database type: unknown"
        );
    }

    #[tokio::test]
    async fn d1_rejects_ssh_before_opening_a_tunnel() {
        let mut config = config("d1");
        config.ssh_enabled = true;

        assert_eq!(
            create_driver_with_ssh(&config).await.err().unwrap(),
            "SSH tunnels are not supported for Cloudflare D1"
        );
    }
}
