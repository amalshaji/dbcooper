//! Lifecycle control and settings for the embedded MCP server.
//!
//! The server is opt-in: it only starts when the `mcp_server_enabled` setting
//! is `true`, and every request must carry a bearer token (`mcp_auth_token`).

use std::sync::Arc;

use sqlx::SqlitePool;
use tokio::sync::Mutex;
use uuid::Uuid;

use super::server::{start_mcp_server, McpServerHandle};
use crate::database::pool_manager::PoolManager;

/// Setting key: whether the MCP server should run (`"true"`/`"false"`).
pub const SETTING_ENABLED: &str = "mcp_server_enabled";
/// Setting key: the bearer token required by every MCP request.
pub const SETTING_TOKEN: &str = "mcp_auth_token";

/// Owns the running MCP server handle and the resources needed to (re)start it.
pub struct McpControl {
    sqlite_pool: SqlitePool,
    pool_manager: Arc<PoolManager>,
    handle: Mutex<Option<McpServerHandle>>,
}

impl McpControl {
    pub fn new(sqlite_pool: SqlitePool, pool_manager: Arc<PoolManager>) -> Self {
        Self {
            sqlite_pool,
            pool_manager,
            handle: Mutex::new(None),
        }
    }

    pub fn sqlite_pool(&self) -> &SqlitePool {
        &self.sqlite_pool
    }

    pub async fn is_running(&self) -> bool {
        self.handle.lock().await.is_some()
    }

    pub async fn port(&self) -> Option<u16> {
        self.handle.lock().await.as_ref().map(|h| h.port)
    }

    /// Start the server if it isn't already running. Returns the bound port.
    /// Read-only mode is always on; writes are rejected by the database engine.
    pub async fn start(&self) -> Result<u16, String> {
        let mut guard = self.handle.lock().await;
        if let Some(handle) = guard.as_ref() {
            return Ok(handle.port);
        }

        let token = get_or_create_token(&self.sqlite_pool).await?;
        let handle = start_mcp_server(
            self.sqlite_pool.clone(),
            self.pool_manager.clone(),
            true,
            token,
        )
        .await
        .map_err(|e| e.to_string())?;

        let port = handle.port;
        *guard = Some(handle);
        Ok(port)
    }

    /// Stop the server if it is running.
    pub async fn stop(&self) {
        if let Some(handle) = self.handle.lock().await.take() {
            handle.cancellation_token.cancel();
        }
    }

    /// Restart the server so a configuration change (e.g. a new token) takes effect.
    pub async fn restart(&self) -> Result<u16, String> {
        self.stop().await;
        self.start().await
    }
}

pub async fn is_enabled(pool: &SqlitePool) -> bool {
    get_setting(pool, SETTING_ENABLED).await.as_deref() == Some("true")
}

pub async fn set_enabled(pool: &SqlitePool, enabled: bool) -> Result<(), String> {
    set_setting(
        pool,
        SETTING_ENABLED,
        if enabled { "true" } else { "false" },
    )
    .await
}

/// Return the stored token, generating and persisting one on first use.
pub async fn get_or_create_token(pool: &SqlitePool) -> Result<String, String> {
    if let Some(token) = get_setting(pool, SETTING_TOKEN).await {
        if !token.is_empty() {
            return Ok(token);
        }
    }
    let token = generate_token();
    set_setting(pool, SETTING_TOKEN, &token).await?;
    Ok(token)
}

pub async fn regenerate_token(pool: &SqlitePool) -> Result<String, String> {
    let token = generate_token();
    set_setting(pool, SETTING_TOKEN, &token).await?;
    Ok(token)
}

fn generate_token() -> String {
    // 256 bits of randomness from two v4 UUIDs.
    format!("{}{}", Uuid::new_v4().simple(), Uuid::new_v4().simple())
}

async fn get_setting(pool: &SqlitePool, key: &str) -> Option<String> {
    sqlx::query_as::<_, crate::db::models::Setting>("SELECT key, value FROM settings WHERE key = ?")
        .bind(key)
        .fetch_optional(pool)
        .await
        .ok()
        .flatten()
        .map(|s| s.value)
}

async fn set_setting(pool: &SqlitePool, key: &str, value: &str) -> Result<(), String> {
    sqlx::query("INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)")
        .bind(key)
        .bind(value)
        .execute(pool)
        .await
        .map(|_| ())
        .map_err(|e| e.to_string())
}
