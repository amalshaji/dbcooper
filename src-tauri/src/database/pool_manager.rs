//! Connection Pool Manager
//!
//! Manages persistent database connections with caching per connection UUID.
//! Provides health checks, auto-reconnect, and connection status tracking.

use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::sync::Arc;
use tokio::sync::{Mutex, RwLock};

use super::driver_factory::create_driver_with_ssh;
pub use super::driver_factory::DriverConfig as ConnectionConfig;
use super::mutation::MutationPlan;
use super::DatabaseDriver;
use crate::db::models::{
    CreateTableRequest, FunctionDefinition, QueryResult, TableDataResponse, TableInfo,
    TableStructure, TestConnectionResult,
};
use crate::ssh_tunnel::SshTunnel;

/// Connection status enum
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum ConnectionStatus {
    Connected,
    Disconnected,
    Reconnecting,
}

/// Entry in the connection pool
struct PoolEntry {
    driver: Arc<Box<dyn DatabaseDriver>>,
    config: ConnectionConfig,
    status: ConnectionStatus,
    last_error: Option<String>,
    #[allow(dead_code)]
    ssh_tunnel: Option<SshTunnel>,
}

/// Connection pool manager
pub struct PoolManager {
    pools: RwLock<HashMap<String, PoolEntry>>,
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
            pools: RwLock::new(HashMap::new()),
            connect_locks: RwLock::new(HashMap::new()),
        }
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
        let (driver, ssh_tunnel) = create_driver_with_ssh(&config).await?;
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

    /// Get a cached driver if it exists (without creating new connection)
    pub async fn get_cached(&self, uuid: &str) -> Option<Arc<Box<dyn DatabaseDriver>>> {
        let pools = self.pools.read().await;
        pools.get(uuid).map(|e| e.driver.clone())
    }

    /// Get config for a cached connection
    pub async fn get_config(&self, uuid: &str) -> Option<ConnectionConfig> {
        let pools = self.pools.read().await;
        pools.get(uuid).map(|e| e.config.clone())
    }

    pub async fn allows_reconnect_retry(&self, uuid: &str) -> bool {
        self.get_config(uuid)
            .await
            .is_some_and(|config| !matches!(config.db_type.as_str(), "d1" | "cloudflare-d1"))
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

    pub async fn execute_mutation(
        &self,
        uuid: &str,
        mutation: &MutationPlan,
    ) -> Result<QueryResult, String> {
        let driver = self
            .get_cached(uuid)
            .await
            .ok_or_else(|| "Connection not found. Please connect first.".to_string())?;
        driver.execute_mutation(mutation).await
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
    use super::PoolManager;
    use std::sync::Arc;

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
