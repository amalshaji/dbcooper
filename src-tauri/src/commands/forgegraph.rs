//! ForgeGraph Tauri commands
//!
//! Commands for syncing, listing, connecting, and managing ForgeGraph-managed
//! database services from within DBcooper.

use crate::database::pool_manager::{ConnectionConfig, ConnectionStatus, PoolManager};
use crate::forgegraph;
use serde::{Deserialize, Serialize};
use sqlx::{FromRow, SqlitePool};
use tauri::State;

use super::pool::ConnectionStatusResponse;

/// Cached ForgeGraph service row from the local SQLite table.
#[derive(Debug, Clone, Serialize, Deserialize, FromRow)]
#[serde(rename_all = "camelCase")]
pub struct CachedService {
    pub id: i64,
    pub app_slug: String,
    pub app_name: String,
    pub stage: String,
    pub kind: String,
    pub node_name: String,
    pub node_status: String,
    pub config: Option<String>,
    pub transports: Option<String>,
    pub synced_at: String,
}

/// Build the synthetic pool key used to identify a ForgeGraph connection.
fn fg_pool_key(app_slug: &str, stage: &str, kind: &str) -> String {
    format!("fg:{}:{}:{}", app_slug, stage, kind)
}

fn credential_string<'a>(credentials: &'a serde_json::Value, keys: &[&str]) -> Option<String> {
    keys.iter()
        .find_map(|key| credentials.get(*key).and_then(|v| v.as_str()))
        .map(|value| value.to_string())
}

/// Read ForgeGraph credentials from `~/.forgegraph/credentials.json` (forge CLI config).
/// Falls back to the settings table if the CLI config is not present.
async fn read_fg_settings(sqlite_pool: &SqlitePool) -> Result<(String, String), String> {
    // Try forge CLI credentials first
    if let Some(home) = dirs::home_dir() {
        let creds_path = home.join(".forgegraph").join("credentials.json");
        if let Ok(contents) = std::fs::read_to_string(&creds_path) {
            if let Ok(creds) = serde_json::from_str::<serde_json::Value>(&contents) {
                let server = creds
                    .get("server")
                    .and_then(|v| v.as_str())
                    .map(String::from);
                let token = creds
                    .get("token")
                    .and_then(|v| v.as_str())
                    .map(String::from);
                if let (Some(s), Some(t)) = (server, token) {
                    if !s.is_empty() && !t.is_empty() {
                        return Ok((s, t));
                    }
                }
            }
        }
    }

    // Fall back to settings table
    let server: Option<crate::db::models::Setting> =
        sqlx::query_as("SELECT key, value FROM settings WHERE key = ?")
            .bind("forgegraph_server")
            .fetch_optional(sqlite_pool)
            .await
            .map_err(|e| format!("Failed to read forgegraph_server setting: {}", e))?;

    let token: Option<crate::db::models::Setting> =
        sqlx::query_as("SELECT key, value FROM settings WHERE key = ?")
            .bind("forgegraph_token")
            .fetch_optional(sqlite_pool)
            .await
            .map_err(|e| format!("Failed to read forgegraph_token setting: {}", e))?;

    let server = server
        .map(|s| s.value)
        .ok_or_else(|| "ForgeGraph server URL not configured".to_string())?;
    let token = token
        .map(|s| s.value)
        .ok_or_else(|| "ForgeGraph API token not configured".to_string())?;

    Ok((server, token))
}

/// Sync services from ForgeGraph API into the local cache table.
///
/// Clears the existing cache and repopulates it with the latest data.
#[tauri::command]
pub async fn forgegraph_sync(
    sqlite_pool: State<'_, SqlitePool>,
) -> Result<Vec<CachedService>, String> {
    let (server, token) = read_fg_settings(sqlite_pool.inner()).await?;

    let services = forgegraph::list_services(&server, &token).await?;

    // Atomic cache refresh: transaction prevents partial state on crash
    let mut tx = sqlite_pool
        .inner()
        .begin()
        .await
        .map_err(|e| format!("Failed to begin transaction: {}", e))?;

    sqlx::query("DELETE FROM forgegraph_services")
        .execute(&mut *tx)
        .await
        .map_err(|e| format!("Failed to clear forgegraph_services: {}", e))?;

    for svc in &services {
        let config_json = serde_json::to_string(&svc.config).unwrap_or_default();
        let transports_json = serde_json::to_string(&svc.transports).unwrap_or_default();

        sqlx::query(
            "INSERT INTO forgegraph_services (app_slug, app_name, stage, kind, node_name, node_status, config, transports)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?)"
        )
        .bind(&svc.app_slug)
        .bind(&svc.app_name)
        .bind(&svc.stage)
        .bind(&svc.kind)
        .bind(&svc.node_name)
        .bind(&svc.node_status)
        .bind(&config_json)
        .bind(&transports_json)
        .execute(&mut *tx)
        .await
        .map_err(|e| format!("Failed to insert service {}: {}", svc.app_slug, e))?;
    }

    tx.commit()
        .await
        .map_err(|e| format!("Failed to commit sync transaction: {}", e))?;

    // Return the cached rows
    forgegraph_list_cached_inner(sqlite_pool.inner()).await
}

/// List cached ForgeGraph services from the local SQLite table.
#[tauri::command]
pub async fn forgegraph_list_cached(
    sqlite_pool: State<'_, SqlitePool>,
) -> Result<Vec<CachedService>, String> {
    forgegraph_list_cached_inner(sqlite_pool.inner()).await
}

/// Inner helper so both `forgegraph_sync` and `forgegraph_list_cached` can reuse the query.
async fn forgegraph_list_cached_inner(pool: &SqlitePool) -> Result<Vec<CachedService>, String> {
    let rows: Vec<CachedService> = sqlx::query_as(
        "SELECT id, app_slug, app_name, stage, kind, node_name, node_status, config, transports, synced_at
         FROM forgegraph_services ORDER BY app_name, stage, kind",
    )
    .fetch_all(pool)
    .await
    .map_err(|e| format!("Failed to list cached services: {}", e))?;

    Ok(rows)
}

/// Connect to a ForgeGraph-managed service.
///
/// Fetches credentials from the ForgeGraph API, picks the first mesh transport,
/// builds a ConnectionConfig, and hands it to the pool manager.
#[tauri::command]
pub async fn forgegraph_connect(
    pool_manager: State<'_, PoolManager>,
    sqlite_pool: State<'_, SqlitePool>,
    app_slug: String,
    stage: String,
    kind: String,
) -> Result<ConnectionStatusResponse, String> {
    let (server, token) = read_fg_settings(sqlite_pool.inner()).await?;

    let conn = forgegraph::get_connection(&server, &token, &app_slug, &stage, &kind).await?;

    // Pick the first "mesh" transport, falling back to the first transport available
    let transport = conn
        .transports
        .iter()
        .find(|t| t.kind == "mesh")
        .or_else(|| conn.transports.first())
        .ok_or_else(|| "No transports available for this service".to_string())?;

    let creds = &conn.credentials;

    let pool_key = fg_pool_key(&app_slug, &stage, &kind);

    let config = match kind.as_str() {
        "postgres" => ConnectionConfig {
            db_type: "postgres".to_string(),
            host: Some(transport.host.clone()),
            port: Some(transport.port as i64),
            database: credential_string(creds, &["database", "dbName"]),
            username: credential_string(creds, &["username", "dbUser", "user"]),
            password: credential_string(creds, &["password"]),
            ssl: Some(true),
            file_path: None,
            ssh_enabled: false,
            ssh_host: None,
            ssh_port: None,
            ssh_user: None,
            ssh_password: None,
            ssh_key_path: None,
        },
        "redis" => ConnectionConfig {
            db_type: "redis".to_string(),
            host: Some(transport.host.clone()),
            port: Some(transport.port as i64),
            database: creds
                .get("dbIndex")
                .and_then(|v| v.as_u64())
                .map(|n| n.to_string()),
            username: creds
                .get("username")
                .and_then(|v| v.as_str())
                .map(|s| s.to_string()),
            password: creds
                .get("password")
                .and_then(|v| v.as_str())
                .map(|s| s.to_string()),
            ssl: Some(false),
            file_path: None,
            ssh_enabled: false,
            ssh_host: None,
            ssh_port: None,
            ssh_user: None,
            ssh_password: None,
            ssh_key_path: None,
        },
        other => {
            return Err(format!("Unsupported service kind: {}", other));
        }
    };

    match pool_manager.connect(&pool_key, config).await {
        Ok(_) => Ok(ConnectionStatusResponse {
            status: ConnectionStatus::Connected,
            error: None,
        }),
        Err(e) => Ok(ConnectionStatusResponse {
            status: ConnectionStatus::Disconnected,
            error: Some(e),
        }),
    }
}

/// Disconnect a ForgeGraph-managed connection from the pool.
#[tauri::command]
pub async fn forgegraph_disconnect(
    pool_manager: State<'_, PoolManager>,
    app_slug: String,
    stage: String,
    kind: String,
) -> Result<(), String> {
    let pool_key = fg_pool_key(&app_slug, &stage, &kind);
    pool_manager.disconnect(&pool_key).await;
    Ok(())
}

/// Get the connection status of a ForgeGraph-managed service.
#[tauri::command]
pub async fn forgegraph_get_status(
    pool_manager: State<'_, PoolManager>,
    app_slug: String,
    stage: String,
    kind: String,
) -> Result<ConnectionStatusResponse, String> {
    let pool_key = fg_pool_key(&app_slug, &stage, &kind);
    let status = pool_manager.get_status(&pool_key).await;
    let error = pool_manager.get_last_error(&pool_key).await;
    Ok(ConnectionStatusResponse { status, error })
}

/// Return the pool key for a ForgeGraph service so the frontend can use it
/// with existing pool-based query commands.
#[tauri::command]
pub async fn forgegraph_pool_key(
    app_slug: String,
    stage: String,
    kind: String,
) -> Result<String, String> {
    Ok(fg_pool_key(&app_slug, &stage, &kind))
}

/// Check whether ForgeGraph credentials are available (CLI config or settings).
#[tauri::command]
pub async fn forgegraph_is_configured(sqlite_pool: State<'_, SqlitePool>) -> Result<bool, String> {
    Ok(read_fg_settings(sqlite_pool.inner()).await.is_ok())
}
