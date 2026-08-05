use super::McpServer;
use rmcp::model::*;
use rmcp::ErrorData as McpError;
use serde_json::{json, Value};

const MAX_ROWS: usize = 1000;
const QUERY_TIMEOUT: std::time::Duration = std::time::Duration::from_secs(30);

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
            "Execute a read-only SQL query against a connected database (writes are rejected by the database engine).",
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
        // Read-only: the engine rejects writes. Not idempotent — results can
        // change between calls and queries may have non-deterministic output.
        .with_annotations(
            ToolAnnotations::new()
                .read_only(true)
                .destructive(false)
                .idempotent(false),
        ),
        Tool::new(
            "mongo_list_namespaces",
            "List databases and collections in a connected MongoDB instance",
            object(connection_uuid_schema("UUID of the connected MongoDB database")),
        )
        .with_annotations(read_only_annotations()),
        Tool::new(
            "mongo_describe_collection",
            "Describe a MongoDB collection and confirm its namespace",
            object(object_schema(
                json!({
                    "connection_uuid": { "type": "string" },
                    "database": { "type": "string" },
                    "collection": { "type": "string" }
                }),
                json!(["connection_uuid", "database", "collection"]),
            )),
        )
        .with_annotations(read_only_annotations()),
        Tool::new(
            "mongo_find",
            "Run a read-only MongoDB find operation (maximum 1000 documents)",
            object(object_schema(
                json!({
                    "connection_uuid": { "type": "string" },
                    "database": { "type": "string" },
                    "collection": { "type": "string" },
                    "filter": { "type": "object", "default": {} },
                    "projection": { "type": "object" },
                    "sort": { "type": "object" },
                    "skip": { "type": "integer", "minimum": 0 },
                    "limit": { "type": "integer", "minimum": 1, "maximum": 1000 }
                }),
                json!(["connection_uuid", "database", "collection"]),
            )),
        )
        .with_annotations(read_only_annotations()),
        Tool::new(
            "mongo_aggregate",
            "Run a read-only MongoDB aggregation; $out and $merge are rejected",
            object(object_schema(
                json!({
                    "connection_uuid": { "type": "string" },
                    "database": { "type": "string" },
                    "collection": { "type": "string" },
                    "pipeline": { "type": "array", "items": { "type": "object" } },
                    "limit": { "type": "integer", "minimum": 1, "maximum": 1000 }
                }),
                json!(["connection_uuid", "database", "collection", "pipeline"]),
            )),
        )
        .with_annotations(read_only_annotations()),
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
        "mongo_list_namespaces" => {
            let uuid = get_str_param(&request.arguments, "connection_uuid")?;
            mongo_list_namespaces(server, uuid).await
        }
        "mongo_describe_collection" => {
            let uuid = get_str_param(&request.arguments, "connection_uuid")?;
            let database = get_str_param(&request.arguments, "database")?;
            let collection = get_str_param(&request.arguments, "collection")?;
            mongo_describe_collection(server, uuid, database, collection).await
        }
        "mongo_find" => mongo_find(server, &request.arguments).await,
        "mongo_aggregate" => mongo_aggregate(server, &request.arguments).await,
        _ => Err(McpError::method_not_found::<CallToolRequestMethod>()),
    }
}

async fn mongo_driver(
    server: &McpServer,
    uuid: &str,
) -> Result<std::sync::Arc<crate::database::mongodb::MongoDriver>, McpError> {
    server.ensure_connected(uuid).await?;
    server
        .pool_manager
        .get_mongo_driver(uuid)
        .await
        .map_err(|error| McpError::invalid_params(error, None))
}

async fn mongo_list_namespaces(server: &McpServer, uuid: &str) -> Result<CallToolResult, McpError> {
    let driver = mongo_driver(server, uuid).await?;
    let catalog = driver
        .catalog()
        .await
        .map_err(|error| McpError::internal_error(error, None))?;
    Ok(CallToolResult::success(vec![Content::text(
        serde_json::to_string_pretty(&catalog).unwrap_or_else(|_| "[]".to_string()),
    )]))
}

async fn mongo_describe_collection(
    server: &McpServer,
    uuid: &str,
    database: &str,
    collection: &str,
) -> Result<CallToolResult, McpError> {
    let driver = mongo_driver(server, uuid).await?;
    let catalog = driver
        .catalog()
        .await
        .map_err(|error| McpError::internal_error(error, None))?;
    let exists = catalog.iter().any(|item| {
        item.name == database
            && item
                .collections
                .iter()
                .any(|entry| entry.name == collection)
    });
    if !exists {
        return Ok(CallToolResult::error(vec![Content::text(
            "MongoDB collection was not found",
        )]));
    }
    let (indexes, validator) = tokio::try_join!(
        driver.list_indexes(database, collection),
        driver.get_validator(database, collection),
    )
    .map_err(|error| McpError::internal_error(error, None))?;
    Ok(CallToolResult::success(vec![Content::text(
        serde_json::to_string_pretty(&json!({
            "database": database,
            "collection": collection,
            "indexes": indexes,
            "validation": validator,
        }))
        .unwrap_or_else(|_| "{}".to_string()),
    )]))
}

async fn mongo_find(
    server: &McpServer,
    arguments: &Option<serde_json::Map<String, Value>>,
) -> Result<CallToolResult, McpError> {
    let args = arguments
        .as_ref()
        .ok_or_else(|| McpError::invalid_params("Missing arguments", None))?;
    let uuid = get_str_param(arguments, "connection_uuid")?;
    let request = crate::database::mongodb::MongoFindRequest {
        database: get_str_param(arguments, "database")?.to_string(),
        collection: get_str_param(arguments, "collection")?.to_string(),
        filter: args.get("filter").cloned().unwrap_or_else(|| json!({})),
        projection: args.get("projection").cloned(),
        sort: args.get("sort").cloned(),
        skip: args.get("skip").and_then(Value::as_u64),
        limit: Some(
            args.get("limit")
                .and_then(Value::as_u64)
                .unwrap_or(MAX_ROWS as u64)
                .min(MAX_ROWS as u64) as u32,
        ),
    };
    let result = tokio::time::timeout(
        QUERY_TIMEOUT,
        mongo_driver(server, uuid).await?.find(request),
    )
    .await
    .map_err(|_| McpError::internal_error("MongoDB query timed out after 30 seconds", None))?
    .map_err(|error| McpError::invalid_params(error, None))?;
    Ok(CallToolResult::success(vec![Content::text(
        serde_json::to_string_pretty(&result).unwrap_or_else(|_| "{}".to_string()),
    )]))
}

async fn mongo_aggregate(
    server: &McpServer,
    arguments: &Option<serde_json::Map<String, Value>>,
) -> Result<CallToolResult, McpError> {
    let args = arguments
        .as_ref()
        .ok_or_else(|| McpError::invalid_params("Missing arguments", None))?;
    let uuid = get_str_param(arguments, "connection_uuid")?;
    let pipeline = args
        .get("pipeline")
        .and_then(Value::as_array)
        .cloned()
        .ok_or_else(|| McpError::invalid_params("pipeline must be an array", None))?;
    let request = crate::database::mongodb::MongoAggregateRequest {
        database: get_str_param(arguments, "database")?.to_string(),
        collection: get_str_param(arguments, "collection")?.to_string(),
        pipeline,
        limit: Some(
            args.get("limit")
                .and_then(Value::as_u64)
                .unwrap_or(MAX_ROWS as u64)
                .min(MAX_ROWS as u64) as u32,
        ),
    };
    let result = tokio::time::timeout(
        QUERY_TIMEOUT,
        mongo_driver(server, uuid).await?.aggregate(request),
    )
    .await
    .map_err(|_| McpError::internal_error("MongoDB query timed out after 30 seconds", None))?
    .map_err(|error| McpError::invalid_params(error, None))?;
    Ok(CallToolResult::success(vec![Content::text(
        serde_json::to_string_pretty(&result).unwrap_or_else(|_| "{}".to_string()),
    )]))
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

    // The MCP server is always read-only; enforcement lives in the driver/engine,
    // not in a string matcher.
    let result = tokio::time::timeout(
        QUERY_TIMEOUT,
        server.pool_manager.execute_query_read_only(uuid, query),
    )
    .await;

    match result {
        Ok(Ok(mut result)) => {
            // Engine-level rejections (e.g. a write in read-only mode) come back
            // as an error on the result; surface them as a tool error.
            if let Some(err) = result.error.take() {
                return Ok(CallToolResult::error(vec![Content::text(err)]));
            }

            let truncated = result.truncated || result.data.len() > MAX_ROWS;
            if result.data.len() > MAX_ROWS {
                result.data.truncate(MAX_ROWS);
            }
            result.row_count = result.data.len() as i64;
            result.truncated = truncated;

            let mut output =
                serde_json::to_string_pretty(&result).unwrap_or_else(|_| "{}".to_string());

            if truncated {
                output.push_str(&format!("\n\n(Results truncated to {} rows)", MAX_ROWS));
            }

            Ok(CallToolResult::success(vec![Content::text(output)]))
        }
        Ok(Err(e)) => Ok(CallToolResult::error(vec![Content::text(format!(
            "Query failed: {}",
            e
        ))])),
        Err(_) => Ok(CallToolResult::error(vec![Content::text(
            "Query timed out after 30 seconds",
        )])),
    }
}
