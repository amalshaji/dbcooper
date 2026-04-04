use super::McpServer;
use rmcp::model::*;
use rmcp::ErrorData as McpError;
use serde_json::json;

/// List available resources — returns the static `dbcooper://connections` resource
/// plus a resource for each currently-connected database's schema.
pub async fn list_resources(server: &McpServer) -> Result<ListResourcesResult, McpError> {
    let mut resources = vec![RawResource::new("dbcooper://connections", "Database Connections")
        .with_description("All saved database connections (credentials redacted)")
        .with_mime_type("application/json")
        .no_annotation()];

    let connections: Vec<crate::db::models::Connection> =
        sqlx::query_as("SELECT * FROM connections ORDER BY id DESC")
            .fetch_all(&server.sqlite_pool)
            .await
            .map_err(|e| McpError::internal_error(format!("Database error: {}", e), None))?;

    for conn in &connections {
        if server.pool_manager.get_cached(&conn.uuid).await.is_some() {
            resources.push(
                RawResource::new(
                    format!("dbcooper://connection/{}/schema", conn.uuid),
                    format!("{} Schema", conn.name),
                )
                .with_description(format!("Schema overview for {} ({})", conn.name, conn.db_type))
                .with_mime_type("application/json")
                .no_annotation(),
            );
        }
    }

    Ok(ListResourcesResult::with_all_items(resources))
}

/// Read a specific resource by URI.
pub async fn read_resource(
    server: &McpServer,
    request: ReadResourceRequestParams,
) -> Result<ReadResourceResult, McpError> {
    let uri = request.uri.as_str();

    if uri == "dbcooper://connections" {
        return read_connections(server).await;
    }

    if let Some(uuid) = uri
        .strip_prefix("dbcooper://connection/")
        .and_then(|rest| rest.strip_suffix("/schema"))
    {
        return read_schema(server, uuid).await;
    }

    Err(McpError::resource_not_found(
        format!("Unknown resource: {}", uri),
        None,
    ))
}

async fn read_connections(server: &McpServer) -> Result<ReadResourceResult, McpError> {
    let connections: Vec<crate::db::models::Connection> =
        sqlx::query_as("SELECT * FROM connections ORDER BY id DESC")
            .fetch_all(&server.sqlite_pool)
            .await
            .map_err(|e| McpError::internal_error(format!("Database error: {}", e), None))?;

    let safe: Vec<serde_json::Value> = connections
        .into_iter()
        .map(|c| {
            json!({
                "uuid": c.uuid,
                "name": c.name,
                "db_type": c.db_type,
                "host": c.host,
                "port": c.port,
                "database": c.database,
                "ssl": c.ssl == 1,
                "ssh_enabled": c.ssh_enabled == 1,
            })
        })
        .collect();

    let text = serde_json::to_string_pretty(&safe).unwrap_or_else(|_| "[]".to_string());

    Ok(ReadResourceResult::new(vec![ResourceContents::text(
        text,
        "dbcooper://connections",
    )]))
}

async fn read_schema(server: &McpServer, uuid: &str) -> Result<ReadResourceResult, McpError> {
    server.ensure_connected(uuid).await?;

    let overview = server
        .pool_manager
        .get_schema_overview(uuid)
        .await
        .map_err(|e| McpError::internal_error(format!("Failed to get schema: {}", e), None))?;

    let text = serde_json::to_string_pretty(&overview).unwrap_or_else(|_| "{}".to_string());

    Ok(ReadResourceResult::new(vec![ResourceContents::text(
        text,
        format!("dbcooper://connection/{}/schema", uuid),
    )]))
}
