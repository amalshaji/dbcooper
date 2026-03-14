pub mod resources;
pub mod tools;

use crate::database::pool_manager::PoolManager;
use crate::database::utils::get_connection_config;
use rmcp::model::*;
use rmcp::{ErrorData as McpError, ServerHandler};
use sqlx::SqlitePool;

pub struct McpServer {
    pub sqlite_pool: SqlitePool,
    pub pool_manager: PoolManager,
    pub read_only: bool,
}

impl McpServer {
    pub fn new(sqlite_pool: SqlitePool, pool_manager: PoolManager, read_only: bool) -> Self {
        Self {
            sqlite_pool,
            pool_manager,
            read_only,
        }
    }

    /// Ensure a connection exists in the pool, connecting if needed.
    pub async fn ensure_connected(&self, uuid: &str) -> Result<(), McpError> {
        if self.pool_manager.get_cached(uuid).await.is_some() {
            return Ok(());
        }

        let config = get_connection_config(&self.sqlite_pool, uuid)
            .await
            .map_err(|e| McpError::internal_error(e, None))?;

        self.pool_manager
            .connect(uuid, config)
            .await
            .map_err(|e| McpError::internal_error(e, None))?;

        Ok(())
    }
}

impl ServerHandler for McpServer {
    fn get_info(&self) -> ServerInfo {
        ServerInfo::new(
            ServerCapabilities::builder()
                .enable_tools()
                .enable_resources()
                .build(),
        )
        .with_server_info(Implementation::new(
            "dbcooper-mcp",
            env!("CARGO_PKG_VERSION"),
        ))
        .with_instructions(
            "DBcooper MCP server — query databases, introspect schemas, and manage connections.",
        )
    }

    fn list_tools(
        &self,
        _request: Option<PaginatedRequestParams>,
        _context: rmcp::service::RequestContext<rmcp::service::RoleServer>,
    ) -> impl std::future::Future<Output = Result<ListToolsResult, McpError>> + Send + '_ {
        std::future::ready(Ok(ListToolsResult::with_all_items(tools::tool_definitions())))
    }

    fn call_tool(
        &self,
        request: CallToolRequestParams,
        _context: rmcp::service::RequestContext<rmcp::service::RoleServer>,
    ) -> impl std::future::Future<Output = Result<CallToolResult, McpError>> + Send + '_ {
        tools::dispatch_tool(self, request)
    }

    fn list_resources(
        &self,
        _request: Option<PaginatedRequestParams>,
        _context: rmcp::service::RequestContext<rmcp::service::RoleServer>,
    ) -> impl std::future::Future<Output = Result<ListResourcesResult, McpError>> + Send + '_ {
        resources::list_resources(self)
    }

    fn read_resource(
        &self,
        request: ReadResourceRequestParams,
        _context: rmcp::service::RequestContext<rmcp::service::RoleServer>,
    ) -> impl std::future::Future<Output = Result<ReadResourceResult, McpError>> + Send + '_ {
        resources::read_resource(self, request)
    }

    fn list_resource_templates(
        &self,
        _request: Option<PaginatedRequestParams>,
        _context: rmcp::service::RequestContext<rmcp::service::RoleServer>,
    ) -> impl std::future::Future<Output = Result<ListResourceTemplatesResult, McpError>> + Send + '_
    {
        std::future::ready(Ok(ListResourceTemplatesResult::with_all_items(vec![
            RawResourceTemplate::new(
                "dbcooper://connection/{uuid}/schema",
                "Connection Schema",
            )
            .with_description("Full schema overview for a connected database")
            .with_mime_type("application/json")
            .no_annotation(),
        ])))
    }
}
