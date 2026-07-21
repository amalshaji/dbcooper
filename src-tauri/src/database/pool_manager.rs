//! Connection Pool Manager
//!
//! Manages persistent database connections with caching per connection UUID.
//! Provides health checks, auto-reconnect, and connection status tracking.

use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::sync::Arc;
use std::time::{Duration, Instant};
use tokio::sync::{Mutex, RwLock};

/// Evict connections idle longer than this so their SSH tunnels and pooled
/// connections don't linger for the whole session.
const IDLE_TIMEOUT: Duration = Duration::from_secs(30 * 60);
/// How often the idle reaper checks for connections to evict.
const IDLE_CHECK_INTERVAL: Duration = Duration::from_secs(5 * 60);

use super::clickhouse::ClickhouseDriver;
use super::postgres::PostgresDriver;
use super::redis::RedisDriver;
use super::sqlite::SqliteDriver;
use super::{
    ClickhouseConfig, ClickhouseProtocol, DatabaseDriver, PostgresConfig, RedisConfig, SqliteConfig,
};
use crate::db::models::{
    CreateTableRequest, FunctionDefinition, QueryResult, TableDataResponse, TableInfo,
    TableStructure, TestConnectionResult,
};
use crate::ssh_tunnel::{SshAuth, SshTunnel};

/// Connection status enum
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum ConnectionStatus {
    Connected,
    Disconnected,
    Reconnecting,
}

/// Configuration needed to create a driver
#[derive(Clone, Debug)]
pub struct ConnectionConfig {
    pub db_type: String,
    pub host: Option<String>,
    pub port: Option<i64>,
    pub database: Option<String>,
    pub username: Option<String>,
    pub password: Option<String>,
    pub ssl: Option<bool>,
    pub file_path: Option<String>,
    // SSH tunnel fields
    pub ssh_enabled: bool,
    pub ssh_host: Option<String>,
    pub ssh_port: Option<i64>,
    pub ssh_user: Option<String>,
    pub ssh_password: Option<String>,
    pub ssh_key_path: Option<String>,
    pub ssh_use_key: bool,
}

/// Entry in the connection pool
struct PoolEntry {
    driver: Arc<Box<dyn DatabaseDriver>>,
    config: ConnectionConfig,
    status: ConnectionStatus,
    /// Interior-mutable so it can be refreshed on each cache hit (read lock) and
    /// read by the idle reaper without taking a write lock on the whole map.
    last_used: std::sync::Mutex<Instant>,
    last_error: Option<String>,
    #[allow(dead_code)]
    ssh_tunnel: Option<SshTunnel>,
}

fn should_keep_entry(entry: &PoolEntry) -> bool {
    if Arc::strong_count(&entry.driver) > 1 {
        if let Ok(mut last_used) = entry.last_used.lock() {
            *last_used = Instant::now();
        }
        return true;
    }

    entry
        .last_used
        .lock()
        .map(|last_used| last_used.elapsed() < IDLE_TIMEOUT)
        .unwrap_or(true)
}

/// Connection pool manager
pub struct PoolManager {
    pools: Arc<RwLock<HashMap<String, PoolEntry>>>,
    /// Mutex per connection UUID to serialize connect/disconnect
    connect_locks: RwLock<HashMap<String, Arc<Mutex<()>>>>,
}

impl Default for PoolManager {
    fn default() -> Self {
        Self::new()
    }
}

impl PoolManager {
    pub fn new() -> Self {
        Self {
            pools: Arc::new(RwLock::new(HashMap::new())),
            connect_locks: RwLock::new(HashMap::new()),
        }
    }

    /// Spawn the background idle reaper. Call once from a context with a running
    /// async runtime (e.g. Tauri's `setup` hook). Evicts connections that have
    /// been idle longer than `IDLE_TIMEOUT`, dropping their SSH tunnels.
    pub fn spawn_idle_reaper(&self) {
        let pools = Arc::clone(&self.pools);
        tauri::async_runtime::spawn(async move {
            let mut ticker = tokio::time::interval(IDLE_CHECK_INTERVAL);
            loop {
                ticker.tick().await;
                let mut pools = pools.write().await;
                pools.retain(|uuid, entry| {
                    let keep = should_keep_entry(entry);
                    if !keep {
                        println!("[Pool] Evicting idle connection {}", uuid);
                    }
                    keep
                });
            }
        });
    }

    /// Get or create a lock for a specific connection UUID
    pub async fn get_connect_lock(&self, uuid: &str) -> Arc<Mutex<()>> {
        {
            let locks = self.connect_locks.read().await;
            if let Some(lock) = locks.get(uuid) {
                return lock.clone();
            }
        }
        // Need to create a new lock
        let mut locks = self.connect_locks.write().await;
        locks
            .entry(uuid.to_string())
            .or_insert_with(|| Arc::new(Mutex::new(())))
            .clone()
    }

    /// Create a driver from configuration (with optional SSH tunnel)
    async fn create_driver(
        config: &ConnectionConfig,
    ) -> Result<(Box<dyn DatabaseDriver>, Option<SshTunnel>), String> {
        // Handle SSH tunnel if enabled
        let (effective_host, effective_port, ssh_tunnel) = if config.ssh_enabled {
            let ssh_host = config.ssh_host.as_ref().ok_or("SSH host is required")?;
            let ssh_port = config.ssh_port.unwrap_or(22) as u16;
            let ssh_user = config.ssh_user.as_ref().ok_or("SSH user is required")?;
            let auth = SshAuth::from_connection(
                config.ssh_use_key,
                config.ssh_password.as_deref(),
                config.ssh_key_path.as_deref(),
            );
            let remote_host = config.host.as_ref().ok_or("Remote host is required")?;
            let remote_port = config.port.unwrap_or(5432) as u16;

            // Use a 20 second timeout for SSH tunnel creation (can take longer due to network/auth)
            let tunnel = match tokio::time::timeout(
                std::time::Duration::from_secs(20),
                SshTunnel::new(ssh_host, ssh_port, ssh_user, auth, remote_host, remote_port),
            )
            .await
            {
                Ok(Ok(tunnel)) => tunnel,
                Ok(Err(e)) => return Err(format!("SSH tunnel failed: {}", e)),
                Err(_) => {
                    return Err("SSH tunnel connection timed out after 20 seconds".to_string())
                }
            };

            (
                "127.0.0.1".to_string(),
                tunnel.local_port as i64,
                Some(tunnel),
            )
        } else {
            (
                config.host.clone().unwrap_or_default(),
                config.port.unwrap_or(5432),
                None,
            )
        };

        match config.db_type.as_str() {
            "postgres" | "postgresql" => {
                let pg_config = PostgresConfig {
                    host: effective_host,
                    port: effective_port,
                    database: config.database.clone().unwrap_or_default(),
                    username: config.username.clone().unwrap_or_default(),
                    password: config.password.clone().unwrap_or_default(),
                    ssl: config.ssl.unwrap_or(false),
                };
                Ok((Box::new(PostgresDriver::new(pg_config)), ssh_tunnel))
            }
            "sqlite" | "sqlite3" => {
                let path = config
                    .file_path
                    .clone()
                    .ok_or("File path is required for SQLite connections")?;
                let sqlite_config = SqliteConfig { file_path: path };
                Ok((Box::new(SqliteDriver::new(sqlite_config)), None))
            }
            "redis" => {
                let redis_config = RedisConfig {
                    host: effective_host,
                    port: effective_port,
                    username: config
                        .username
                        .clone()
                        .filter(|username| !username.is_empty()),
                    password: config.password.clone(),
                    db: config.database.clone().and_then(|d| d.parse().ok()),
                    tls: config.ssl.unwrap_or(false),
                };
                Ok((Box::new(RedisDriver::new(redis_config)), ssh_tunnel))
            }
            "clickhouse" => {
                let ch_config = ClickhouseConfig {
                    host: effective_host,
                    port: effective_port,
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
                };
                Ok((Box::new(ClickhouseDriver::new(ch_config)), ssh_tunnel))
            }
            _ => Err(format!("Unsupported database type: {}", config.db_type)),
        }
    }

    /// Ensure a connection exists in the pool, connecting if needed.
    ///
    /// Serialized per-UUID via the connect lock so concurrent callers (Tauri
    /// commands and the MCP server) can't race on the same connection.
    pub async fn ensure_connected(
        &self,
        sqlite_pool: &sqlx::SqlitePool,
        uuid: &str,
    ) -> Result<(), String> {
        let lock = self.get_connect_lock(uuid).await;
        let _guard = lock.lock().await;

        // Re-check under the lock; another caller may have just connected.
        if self.get_cached(uuid).await.is_some() {
            return Ok(());
        }

        crate::docker::ensure_created_connection_running(sqlite_pool, uuid).await?;
        let config = crate::database::utils::get_connection_config(sqlite_pool, uuid).await?;
        self.connect(uuid, config).await?;
        Ok(())
    }

    /// Explicitly connect (or reconnect) a connection
    pub async fn connect(
        &self,
        uuid: &str,
        config: ConnectionConfig,
    ) -> Result<Arc<Box<dyn DatabaseDriver>>, String> {
        // Update status to reconnecting if entry exists
        {
            let mut pools = self.pools.write().await;
            if let Some(entry) = pools.get_mut(uuid) {
                entry.status = ConnectionStatus::Reconnecting;
            }
        }

        // Create new driver (with optional SSH tunnel)
        let (driver, ssh_tunnel) = Self::create_driver(&config).await?;
        let driver = Arc::new(driver);

        // Test the connection
        let test_result = driver.test_connection().await?;

        let status = if test_result.success {
            ConnectionStatus::Connected
        } else {
            ConnectionStatus::Disconnected
        };

        let entry = PoolEntry {
            driver: driver.clone(),
            config,
            status: status.clone(),
            last_used: std::sync::Mutex::new(Instant::now()),
            last_error: if test_result.success {
                None
            } else {
                Some(test_result.message.clone())
            },
            ssh_tunnel,
        };

        // Store in pool
        {
            let mut pools = self.pools.write().await;
            pools.insert(uuid.to_string(), entry);
        }

        if status == ConnectionStatus::Connected {
            Ok(driver)
        } else {
            Err(test_result.message)
        }
    }

    /// Disconnect and remove a connection from the pool
    pub async fn disconnect(&self, uuid: &str) {
        let lock = self.get_connect_lock(uuid).await;
        let _guard = lock.lock().await;
        self.disconnect_locked(uuid).await;
    }

    pub(crate) async fn disconnect_locked(&self, uuid: &str) {
        let mut pools = self.pools.write().await;
        pools.remove(uuid);
    }

    /// Get the current status of a connection
    pub async fn get_status(&self, uuid: &str) -> ConnectionStatus {
        let pools = self.pools.read().await;
        pools
            .get(uuid)
            .map(|e| e.status.clone())
            .unwrap_or(ConnectionStatus::Disconnected)
    }

    /// Get the last error for a connection
    pub async fn get_last_error(&self, uuid: &str) -> Option<String> {
        let pools = self.pools.read().await;
        pools.get(uuid).and_then(|e| e.last_error.clone())
    }

    /// Perform a health check on a connection
    pub async fn health_check(&self, uuid: &str) -> Result<TestConnectionResult, String> {
        let driver = {
            let pools = self.pools.read().await;
            pools.get(uuid).map(|e| e.driver.clone())
        };

        match driver {
            Some(driver) => {
                let result = driver.test_connection().await?;

                // Update status based on result
                {
                    let mut pools = self.pools.write().await;
                    if let Some(entry) = pools.get_mut(uuid) {
                        entry.status = if result.success {
                            ConnectionStatus::Connected
                        } else {
                            ConnectionStatus::Disconnected
                        };
                        entry.last_error = if result.success {
                            None
                        } else {
                            Some(result.message.clone())
                        };
                    }
                }

                Ok(result)
            }
            None => Ok(TestConnectionResult {
                success: false,
                message: "Connection not found".to_string(),
            }),
        }
    }

    /// Get a cached driver if it exists (without creating new connection).
    /// Refreshes the entry's last-used time so the idle reaper keeps connections
    /// that are actively in use.
    pub async fn get_cached(&self, uuid: &str) -> Option<Arc<Box<dyn DatabaseDriver>>> {
        let pools = self.pools.read().await;
        pools.get(uuid).map(|e| {
            if let Ok(mut t) = e.last_used.lock() {
                *t = Instant::now();
            }
            e.driver.clone()
        })
    }

    /// Get config for a cached connection
    pub async fn get_config(&self, uuid: &str) -> Option<ConnectionConfig> {
        let pools = self.pools.read().await;
        pools.get(uuid).map(|e| e.config.clone())
    }

    /// List tables using the pooled connection
    pub async fn list_tables(&self, uuid: &str) -> Result<Vec<TableInfo>, String> {
        let driver = self
            .get_cached(uuid)
            .await
            .ok_or_else(|| "Connection not found. Please connect first.".to_string())?;
        driver.list_tables().await
    }

    pub async fn preview_create_table(
        &self,
        uuid: &str,
        request: &CreateTableRequest,
    ) -> Result<String, String> {
        let driver = self
            .get_cached(uuid)
            .await
            .ok_or_else(|| "Connection not found. Please connect first.".to_string())?;
        driver.preview_create_table(request)
    }

    pub async fn create_table(
        &self,
        uuid: &str,
        request: &CreateTableRequest,
    ) -> Result<TableInfo, String> {
        let driver = self
            .get_cached(uuid)
            .await
            .ok_or_else(|| "Connection not found. Please connect first.".to_string())?;
        driver.create_table(request).await
    }

    /// Get table data using the pooled connection
    pub async fn get_table_data(
        &self,
        uuid: &str,
        schema: &str,
        table: &str,
        page: i64,
        limit: i64,
        filter: Option<crate::db::models::TableFilter>,
        sort_column: Option<String>,
        sort_direction: Option<String>,
    ) -> Result<TableDataResponse, String> {
        let driver = self
            .get_cached(uuid)
            .await
            .ok_or_else(|| "Connection not found. Please connect first.".to_string())?;
        driver
            .get_table_data(
                schema,
                table,
                page,
                limit,
                filter,
                sort_column,
                sort_direction,
            )
            .await
    }

    /// Get table structure using the pooled connection
    pub async fn get_table_structure(
        &self,
        uuid: &str,
        schema: &str,
        table: &str,
    ) -> Result<TableStructure, String> {
        let driver = self
            .get_cached(uuid)
            .await
            .ok_or_else(|| "Connection not found. Please connect first.".to_string())?;
        driver.get_table_structure(schema, table).await
    }

    /// Execute query using the pooled connection
    pub async fn execute_query(&self, uuid: &str, query: &str) -> Result<QueryResult, String> {
        let driver = self
            .get_cached(uuid)
            .await
            .ok_or_else(|| "Connection not found. Please connect first.".to_string())?;
        driver.execute_query(query).await
    }

    /// Execute a query with read-only enforcement (engine-enforced where possible).
    pub async fn execute_query_read_only(
        &self,
        uuid: &str,
        query: &str,
    ) -> Result<QueryResult, String> {
        let driver = self
            .get_cached(uuid)
            .await
            .ok_or_else(|| "Connection not found. Please connect first.".to_string())?;
        driver.execute_query_read_only(query).await
    }

    /// Get schema overview using the pooled connection
    pub async fn get_schema_overview(
        &self,
        uuid: &str,
    ) -> Result<crate::db::models::SchemaOverview, String> {
        let driver = self
            .get_cached(uuid)
            .await
            .ok_or_else(|| "Connection not found. Please connect first.".to_string())?;

        driver.get_schema_overview().await
    }

    /// Get a function definition using the pooled connection
    pub async fn get_function_definition(
        &self,
        uuid: &str,
        schema: &str,
        name: &str,
        identity_args: &str,
    ) -> Result<FunctionDefinition, String> {
        let driver = self
            .get_cached(uuid)
            .await
            .ok_or_else(|| "Connection not found. Please connect first.".to_string())?;

        driver
            .get_function_definition(schema, name, identity_args)
            .await
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn expired_entry() -> PoolEntry {
        let driver: Arc<Box<dyn DatabaseDriver>> =
            Arc::new(Box::new(RedisDriver::new(RedisConfig {
                host: "localhost".to_string(),
                port: 6379,
                username: None,
                password: None,
                db: None,
                tls: false,
            })));

        PoolEntry {
            driver,
            config: ConnectionConfig {
                db_type: "redis".to_string(),
                host: Some("localhost".to_string()),
                port: Some(6379),
                database: None,
                username: None,
                password: None,
                ssl: Some(false),
                file_path: None,
                ssh_enabled: false,
                ssh_host: None,
                ssh_port: None,
                ssh_user: None,
                ssh_password: None,
                ssh_key_path: None,
                ssh_use_key: false,
            },
            status: ConnectionStatus::Connected,
            last_used: std::sync::Mutex::new(Instant::now() - IDLE_TIMEOUT),
            last_error: None,
            ssh_tunnel: None,
        }
    }

    #[test]
    fn evicts_an_expired_entry_without_an_active_operation() {
        let entry = expired_entry();

        assert!(!should_keep_entry(&entry));
    }

    #[test]
    fn retains_an_expired_entry_while_an_operation_holds_the_driver() {
        let entry = expired_entry();
        let _active_driver = Arc::clone(&entry.driver);

        assert!(should_keep_entry(&entry));
        assert!(entry.last_used.lock().unwrap().elapsed() < Duration::from_secs(1));
    }

    #[tokio::test]
    async fn disconnect_waits_for_the_connection_lifecycle_lock() {
        let manager = Arc::new(PoolManager::new());
        let lock = manager.get_connect_lock("connection-1").await;
        let guard = lock.lock().await;
        let disconnect = {
            let manager = manager.clone();
            tokio::spawn(async move { manager.disconnect("connection-1").await })
        };

        tokio::task::yield_now().await;
        assert!(!disconnect.is_finished());

        drop(guard);
        disconnect.await.unwrap();
    }
}
