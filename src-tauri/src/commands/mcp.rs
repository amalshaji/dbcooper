//! Tauri commands for controlling the embedded MCP server.

use std::sync::Arc;

use serde::Serialize;
use tauri::State;

use crate::mcp::control::{self, McpControl};

#[derive(Serialize)]
pub struct McpStatus {
    /// Whether the server is configured to run.
    pub enabled: bool,
    /// Whether the server is currently listening.
    pub running: bool,
    pub port: Option<u16>,
    pub url: Option<String>,
    /// Bearer token clients must send as `Authorization: Bearer <token>`.
    pub token: String,
}

async fn build_status(control: &McpControl) -> Result<McpStatus, String> {
    let pool = control.sqlite_pool();
    let port = control.port().await;
    Ok(McpStatus {
        enabled: control::is_enabled(pool).await,
        running: control.is_running().await,
        port,
        url: port.map(|p| format!("http://127.0.0.1:{}/mcp", p)),
        token: control::get_or_create_token(pool).await?,
    })
}

#[tauri::command]
pub async fn mcp_get_status(control: State<'_, Arc<McpControl>>) -> Result<McpStatus, String> {
    build_status(control.inner()).await
}

#[tauri::command]
pub async fn mcp_set_enabled(
    control: State<'_, Arc<McpControl>>,
    enabled: bool,
) -> Result<McpStatus, String> {
    control::set_enabled(control.sqlite_pool(), enabled).await?;
    if enabled {
        control.start().await?;
    } else {
        control.stop().await;
    }
    build_status(control.inner()).await
}

#[tauri::command]
pub async fn mcp_regenerate_token(
    control: State<'_, Arc<McpControl>>,
) -> Result<McpStatus, String> {
    control::regenerate_token(control.sqlite_pool()).await?;
    // Restart so the new token takes effect for future requests.
    if control.is_running().await {
        control.restart().await?;
    }
    build_status(control.inner()).await
}
