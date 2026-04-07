use std::sync::Arc;

use rmcp::transport::streamable_http_server::session::local::LocalSessionManager;
use rmcp::transport::streamable_http_server::{StreamableHttpServerConfig, StreamableHttpService};
use sqlx::SqlitePool;
use tokio::net::TcpListener;
use tokio_util::sync::CancellationToken;

use super::McpServer;
use crate::database::pool_manager::PoolManager;

const DEFAULT_PORT: u16 = 9420;
const MAX_PORT_ATTEMPTS: u16 = 10;

pub struct McpServerHandle {
    pub port: u16,
    pub cancellation_token: CancellationToken,
}

pub async fn start_mcp_server(
    sqlite_pool: SqlitePool,
    pool_manager: Arc<PoolManager>,
    read_only: bool,
) -> Result<McpServerHandle, Box<dyn std::error::Error + Send + Sync>> {
    let ct = CancellationToken::new();

    let (listener, port) = bind_with_retry(DEFAULT_PORT, MAX_PORT_ATTEMPTS).await?;

    let config = StreamableHttpServerConfig::default()
        .with_cancellation_token(ct.child_token());

    let service = StreamableHttpService::new(
        move || {
            Ok(McpServer::new(
                sqlite_pool.clone(),
                pool_manager.clone(),
                read_only,
            ))
        },
        Arc::new(LocalSessionManager::default()),
        config,
    );

    let router = axum::Router::new().nest_service("/mcp", service);

    let shutdown_ct = ct.clone();
    tokio::spawn(async move {
        let _ = axum::serve(listener, router)
            .with_graceful_shutdown(async move { shutdown_ct.cancelled().await })
            .await;
    });

    Ok(McpServerHandle {
        port,
        cancellation_token: ct,
    })
}

async fn bind_with_retry(
    start_port: u16,
    max_attempts: u16,
) -> Result<(TcpListener, u16), Box<dyn std::error::Error + Send + Sync>> {
    for offset in 0..max_attempts {
        let port = start_port + offset;
        match TcpListener::bind(("127.0.0.1", port)).await {
            Ok(listener) => return Ok((listener, port)),
            Err(e) if e.kind() == std::io::ErrorKind::AddrInUse => continue,
            Err(e) => return Err(e.into()),
        }
    }
    Err(format!(
        "Could not bind to any port in range {}-{}",
        start_port,
        start_port + max_attempts - 1
    )
    .into())
}
