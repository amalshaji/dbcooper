use super::McpServer;
use rmcp::model::*;
use rmcp::ErrorData as McpError;
use serde_json::{json, Value};

const MAX_ROWS: usize = 1000;

/// Build an object JSON schema from its properties and required keys.
fn object_schema(properties: Value, required: Value) -> Value {
    json!({ "type": "object", "properties": properties, "required": required })
}

/// Schema for tools that take only a `connection_uuid`.
fn connection_uuid_schema(description: &str) -> Value {
    object_schema(
        json!({ "connection_uuid": { "type": "string", "description": description } }),
        json!(["connection_uuid"]),
    )
}

/// Annotations for a tool that only reads and never mutates state.
fn read_only_annotations() -> ToolAnnotations {
    ToolAnnotations::new()
        .read_only(true)
        .destructive(false)
        .idempotent(true)
}

/// Return the list of all tool definitions.
pub fn tool_definitions() -> Vec<Tool> {
    vec![
        Tool::new(
            "list_connections",
            "List all saved database connections (credentials are redacted)",
            object(object_schema(json!({}), json!([]))),
        )
        .with_annotations(read_only_annotations()),
        Tool::new(
            "connect",
            "Connect to a saved database by its UUID",
            object(connection_uuid_schema("UUID of the saved connection")),
        )
        .with_annotations(
            ToolAnnotations::new()
                .read_only(false)
                .destructive(false)
                .idempotent(true),
        ),
        Tool::new(
            "disconnect",
            "Disconnect from a database",
            object(connection_uuid_schema("UUID of the connection to disconnect")),
        )
        .with_annotations(
            ToolAnnotations::new()
                .read_only(false)
                .destructive(false)
                .idempotent(true),
        ),
        Tool::new(
            "list_tables",
            "List all tables in a connected database",
            object(connection_uuid_schema("UUID of the connected database")),
        )
        .with_annotations(read_only_annotations()),
        Tool::new(
            "describe_table",
            "Get table structure including columns, indexes, and foreign keys",
            object(object_schema(
                json!({
                    "connection_uuid": {
                        "type": "string",
                        "description": "UUID of the connected database"
                    },
                    "schema": {
                        "type": "string",
                        "description": "Schema name (e.g. 'public' for PostgreSQL)"
                    },
                    "table": {
                        "type": "string",
                        "description": "Table name"
                    }
                }),
                json!(["connection_uuid", "schema", "table"]),
            )),
        )
        .with_annotations(read_only_annotations()),
        Tool::new(
            "get_schema_overview",
            "Get full schema overview with all tables, columns, indexes, and relationships",
            object(connection_uuid_schema("UUID of the connected database")),
        )
        .with_annotations(read_only_annotations()),
        Tool::new(
            "execute_query",
            "Execute a SQL query against a connected database. Read-only by default (writes are rejected by the database engine).",
            object(object_schema(
                json!({
                    "connection_uuid": {
                        "type": "string",
                        "description": "UUID of the connected database"
                    },
                    "query": {
                        "type": "string",
                        "description": "SQL query to execute"
                    }
                }),
                json!(["connection_uuid", "query"]),
            )),
        )
        .with_annotations(
            // Worst-case hint: when the server is not in read-only mode this can mutate data.
            ToolAnnotations::new()
                .read_only(false)
                .destructive(true)
                .idempotent(false),
        ),
    ]
}

fn get_str_param<'a>(
    args: &'a Option<serde_json::Map<String, Value>>,
    key: &str,
) -> Result<&'a str, McpError> {
    args.as_ref()
        .and_then(|m| m.get(key))
        .and_then(|v| v.as_str())
        .ok_or_else(|| {
            McpError::invalid_params(format!("Missing required parameter: {}", key), None)
        })
}

/// Dispatch a tool call to the appropriate handler.
pub async fn dispatch_tool(
    server: &McpServer,
    request: CallToolRequestParams,
) -> Result<CallToolResult, McpError> {
    match request.name.as_ref() {
        "list_connections" => list_connections(server).await,
        "connect" => {
            let uuid = get_str_param(&request.arguments, "connection_uuid")?;
            connect(server, uuid).await
        }
        "disconnect" => {
            let uuid = get_str_param(&request.arguments, "connection_uuid")?;
            disconnect(server, uuid).await
        }
        "list_tables" => {
            let uuid = get_str_param(&request.arguments, "connection_uuid")?;
            list_tables(server, uuid).await
        }
        "describe_table" => {
            let uuid = get_str_param(&request.arguments, "connection_uuid")?;
            let schema = get_str_param(&request.arguments, "schema")?;
            let table = get_str_param(&request.arguments, "table")?;
            describe_table(server, uuid, schema, table).await
        }
        "get_schema_overview" => {
            let uuid = get_str_param(&request.arguments, "connection_uuid")?;
            get_schema_overview(server, uuid).await
        }
        "execute_query" => {
            let uuid = get_str_param(&request.arguments, "connection_uuid")?;
            let query = get_str_param(&request.arguments, "query")?;
            execute_query(server, uuid, query).await
        }
        _ => Err(McpError::method_not_found::<CallToolRequestMethod>()),
    }
}

async fn list_connections(server: &McpServer) -> Result<CallToolResult, McpError> {
    let connections: Vec<crate::db::models::Connection> =
        sqlx::query_as("SELECT * FROM connections ORDER BY id DESC")
            .fetch_all(&server.sqlite_pool)
            .await
            .map_err(|e| McpError::internal_error(format!("Database error: {}", e), None))?;

    let safe: Vec<Value> = connections
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
    Ok(CallToolResult::success(vec![Content::text(text)]))
}

async fn connect(server: &McpServer, uuid: &str) -> Result<CallToolResult, McpError> {
    match server.ensure_connected(uuid).await {
        Ok(()) => Ok(CallToolResult::success(vec![Content::text(format!(
            "Connected to {} successfully.",
            uuid
        ))])),
        Err(e) => Ok(CallToolResult::error(vec![Content::text(format!(
            "Failed to connect: {}",
            e
        ))])),
    }
}

async fn disconnect(server: &McpServer, uuid: &str) -> Result<CallToolResult, McpError> {
    server.pool_manager.disconnect(uuid).await;
    Ok(CallToolResult::success(vec![Content::text(format!(
        "Disconnected from {}.",
        uuid
    ))]))
}

async fn list_tables(server: &McpServer, uuid: &str) -> Result<CallToolResult, McpError> {
    server.ensure_connected(uuid).await?;

    match server.pool_manager.list_tables(uuid).await {
        Ok(tables) => {
            let json = serde_json::to_string_pretty(&tables).unwrap_or_else(|_| "[]".to_string());
            Ok(CallToolResult::success(vec![Content::text(json)]))
        }
        Err(e) => Ok(CallToolResult::error(vec![Content::text(format!(
            "Failed to list tables: {}",
            e
        ))])),
    }
}

async fn describe_table(
    server: &McpServer,
    uuid: &str,
    schema: &str,
    table: &str,
) -> Result<CallToolResult, McpError> {
    server.ensure_connected(uuid).await?;

    match server
        .pool_manager
        .get_table_structure(uuid, schema, table)
        .await
    {
        Ok(structure) => {
            let json =
                serde_json::to_string_pretty(&structure).unwrap_or_else(|_| "{}".to_string());
            Ok(CallToolResult::success(vec![Content::text(json)]))
        }
        Err(e) => Ok(CallToolResult::error(vec![Content::text(format!(
            "Failed to describe table: {}",
            e
        ))])),
    }
}

async fn get_schema_overview(server: &McpServer, uuid: &str) -> Result<CallToolResult, McpError> {
    server.ensure_connected(uuid).await?;

    match server.pool_manager.get_schema_overview(uuid).await {
        Ok(overview) => {
            let json = serde_json::to_string_pretty(&overview).unwrap_or_else(|_| "{}".to_string());
            Ok(CallToolResult::success(vec![Content::text(json)]))
        }
        Err(e) => Ok(CallToolResult::error(vec![Content::text(format!(
            "Failed to get schema overview: {}",
            e
        ))])),
    }
}

async fn execute_query(
    server: &McpServer,
    uuid: &str,
    query: &str,
) -> Result<CallToolResult, McpError> {
    server.ensure_connected(uuid).await?;

    // Read-only enforcement lives in the driver/engine, not in a string matcher.
    let result = if server.read_only {
        server
            .pool_manager
            .execute_query_read_only(uuid, query)
            .await
    } else {
        server.pool_manager.execute_query(uuid, query).await
    };

    match result {
        Ok(mut result) => {
            // Engine-level rejections (e.g. a write in read-only mode) come back
            // as an error on the result; surface them as a tool error.
            if let Some(err) = result.error.take() {
                return Ok(CallToolResult::error(vec![Content::text(err)]));
            }

            let truncated = result.data.len() > MAX_ROWS;
            if truncated {
                result.data.truncate(MAX_ROWS);
            }

            let mut output =
                serde_json::to_string_pretty(&result).unwrap_or_else(|_| "{}".to_string());

            if truncated {
                output.push_str(&format!("\n\n(Results truncated to {} rows)", MAX_ROWS));
            }

            Ok(CallToolResult::success(vec![Content::text(output)]))
        }
        Err(e) => Ok(CallToolResult::error(vec![Content::text(format!(
            "Query failed: {}",
            e
        ))])),
    }
}
