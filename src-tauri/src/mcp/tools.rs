use super::McpServer;
use crate::database::utils::get_connection_config;
use rmcp::model::*;
use rmcp::ErrorData as McpError;
use serde_json::json;

const MAX_ROWS: usize = 1000;

/// Return the list of all tool definitions.
pub fn tool_definitions() -> Vec<Tool> {
    vec![
        Tool::new(
            "list_connections",
            "List all saved database connections (credentials are redacted)",
            object(json!({
                "type": "object",
                "properties": {},
                "required": []
            })),
        )
        .with_annotations(
            ToolAnnotations::new()
                .read_only(true)
                .destructive(false)
                .idempotent(true),
        ),
        Tool::new(
            "connect",
            "Connect to a saved database by its UUID",
            object(json!({
                "type": "object",
                "properties": {
                    "connection_uuid": {
                        "type": "string",
                        "description": "UUID of the saved connection"
                    }
                },
                "required": ["connection_uuid"]
            })),
        ),
        Tool::new(
            "disconnect",
            "Disconnect from a database",
            object(json!({
                "type": "object",
                "properties": {
                    "connection_uuid": {
                        "type": "string",
                        "description": "UUID of the connection to disconnect"
                    }
                },
                "required": ["connection_uuid"]
            })),
        ),
        Tool::new(
            "list_tables",
            "List all tables in a connected database",
            object(json!({
                "type": "object",
                "properties": {
                    "connection_uuid": {
                        "type": "string",
                        "description": "UUID of the connected database"
                    }
                },
                "required": ["connection_uuid"]
            })),
        )
        .with_annotations(
            ToolAnnotations::new()
                .read_only(true)
                .destructive(false)
                .idempotent(true),
        ),
        Tool::new(
            "describe_table",
            "Get table structure including columns, indexes, and foreign keys",
            object(json!({
                "type": "object",
                "properties": {
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
                },
                "required": ["connection_uuid", "schema", "table"]
            })),
        )
        .with_annotations(
            ToolAnnotations::new()
                .read_only(true)
                .destructive(false)
                .idempotent(true),
        ),
        Tool::new(
            "get_schema_overview",
            "Get full schema overview with all tables, columns, indexes, and relationships",
            object(json!({
                "type": "object",
                "properties": {
                    "connection_uuid": {
                        "type": "string",
                        "description": "UUID of the connected database"
                    }
                },
                "required": ["connection_uuid"]
            })),
        )
        .with_annotations(
            ToolAnnotations::new()
                .read_only(true)
                .destructive(false)
                .idempotent(true),
        ),
        Tool::new(
            "execute_query",
            "Execute a SQL query against a connected database. Read-only by default (SELECT/WITH/EXPLAIN only).",
            object(json!({
                "type": "object",
                "properties": {
                    "connection_uuid": {
                        "type": "string",
                        "description": "UUID of the connected database"
                    },
                    "query": {
                        "type": "string",
                        "description": "SQL query to execute"
                    }
                },
                "required": ["connection_uuid", "query"]
            })),
        ),
    ]
}

fn get_str_param<'a>(
    args: &'a Option<serde_json::Map<String, serde_json::Value>>,
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
    Ok(CallToolResult::success(vec![Content::text(text)]))
}

async fn connect(server: &McpServer, uuid: &str) -> Result<CallToolResult, McpError> {
    let config = get_connection_config(&server.sqlite_pool, uuid)
        .await
        .map_err(|e| McpError::internal_error(e, None))?;

    match server.pool_manager.connect(uuid, config).await {
        Ok(_) => Ok(CallToolResult::success(vec![Content::text(format!(
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
            let json =
                serde_json::to_string_pretty(&tables).unwrap_or_else(|_| "[]".to_string());
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
            let json =
                serde_json::to_string_pretty(&overview).unwrap_or_else(|_| "{}".to_string());
            Ok(CallToolResult::success(vec![Content::text(json)]))
        }
        Err(e) => Ok(CallToolResult::error(vec![Content::text(format!(
            "Failed to get schema overview: {}",
            e
        ))])),
    }
}

/// Check if a SQL query is read-only (SELECT, WITH, EXPLAIN, SHOW, DESCRIBE only).
fn is_read_only_sql_query(query: &str) -> bool {
    let trimmed = query.trim().to_uppercase();
    let effective = if trimmed.starts_with("--") {
        trimmed
            .lines()
            .find(|l| !l.trim_start().starts_with("--"))
            .unwrap_or("")
            .to_string()
    } else if trimmed.starts_with("/*") {
        trimmed
            .find("*/")
            .map(|i| trimmed[i + 2..].trim().to_string())
            .unwrap_or_default()
    } else {
        trimmed
    };

    let first_word = effective
        .split_whitespace()
        .next()
        .unwrap_or("")
        .to_uppercase();

    matches!(
        first_word.as_str(),
        "SELECT" | "WITH" | "EXPLAIN" | "SHOW" | "DESCRIBE" | "DESC" | "PRAGMA"
    )
}

/// Check if a Redis command is read-only.
fn is_read_only_redis_command(query: &str) -> bool {
    let command = query
        .trim()
        .split_whitespace()
        .next()
        .unwrap_or("")
        .to_uppercase();

    matches!(
        command.as_str(),
        // String commands
        "GET" | "MGET" | "STRLEN" | "GETRANGE" | "SUBSTR"
        // Key commands
        | "EXISTS" | "TYPE" | "TTL" | "PTTL" | "KEYS" | "SCAN"
        | "RANDOMKEY" | "DUMP" | "OBJECT" | "TOUCH"
        // List commands
        | "LLEN" | "LRANGE" | "LINDEX" | "LPOS"
        // Hash commands
        | "HGET" | "HGETALL" | "HKEYS" | "HVALS" | "HLEN"
        | "HEXISTS" | "HMGET" | "HSCAN" | "HRANDFIELD"
        // Set commands
        | "SCARD" | "SISMEMBER" | "SMISMEMBER" | "SMEMBERS"
        | "SRANDMEMBER" | "SSCAN" | "SINTER" | "SUNION" | "SDIFF"
        | "SINTERCARD"
        // Sorted set commands
        | "ZCARD" | "ZCOUNT" | "ZRANGE" | "ZRANGEBYSCORE"
        | "ZREVRANGE" | "ZREVRANGEBYSCORE" | "ZRANK" | "ZREVRANK"
        | "ZSCORE" | "ZMSCORE" | "ZSCAN" | "ZRANGEBYLEX"
        | "ZREVRANGEBYLEX" | "ZLEXCOUNT" | "ZRANDMEMBER"
        // Server / connection commands
        | "DBSIZE" | "INFO" | "PING" | "ECHO" | "TIME" | "CLIENT"
        // Stream commands
        | "XLEN" | "XRANGE" | "XREVRANGE" | "XINFO" | "XREAD" | "XPENDING"
        // HyperLogLog
        | "PFCOUNT"
        // Geo commands
        | "GEOSEARCH" | "GEOPOS" | "GEODIST" | "GEOHASH"
        | "GEORADIUS_RO" | "GEORADIUSBYMEMBER_RO"
        // Memory
        | "MEMORY"
        // Misc
        | "WAIT"
    )
}

/// Check if a query/command is read-only for the given database type.
fn is_read_only(db_type: &str, query: &str) -> bool {
    match db_type.to_lowercase().as_str() {
        "redis" => is_read_only_redis_command(query),
        _ => is_read_only_sql_query(query),
    }
}

async fn execute_query(
    server: &McpServer,
    uuid: &str,
    query: &str,
) -> Result<CallToolResult, McpError> {
    if server.read_only {
        let db_type = if let Some(config) = server.pool_manager.get_config(uuid).await {
            config.db_type
        } else {
            get_connection_config(&server.sqlite_pool, uuid)
                .await
                .map(|c| c.db_type)
                .unwrap_or_default()
        };

        if !is_read_only(&db_type, query) {
            let msg = match db_type.to_lowercase().as_str() {
                "redis" => "Read-only mode: only read commands (GET, KEYS, LLEN, INFO, SCAN, etc.) are allowed. Write commands like SET, DEL, FLUSHDB are blocked.",
                _ => "Read-only mode: only SELECT, WITH, EXPLAIN, SHOW, and DESCRIBE queries are allowed.",
            };
            return Ok(CallToolResult::error(vec![Content::text(msg)]));
        }
    }

    server.ensure_connected(uuid).await?;

    match server.pool_manager.execute_query(uuid, query).await {
        Ok(mut result) => {
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

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_read_only_sql_detection() {
        assert!(is_read_only_sql_query("SELECT * FROM users"));
        assert!(is_read_only_sql_query("  select * from users"));
        assert!(is_read_only_sql_query(
            "WITH cte AS (SELECT 1) SELECT * FROM cte"
        ));
        assert!(is_read_only_sql_query("EXPLAIN SELECT * FROM users"));
        assert!(is_read_only_sql_query("SHOW tables"));
        assert!(is_read_only_sql_query("DESCRIBE users"));
        assert!(is_read_only_sql_query("PRAGMA table_info(users)"));

        assert!(!is_read_only_sql_query("INSERT INTO users VALUES (1)"));
        assert!(!is_read_only_sql_query("UPDATE users SET name = 'x'"));
        assert!(!is_read_only_sql_query("DELETE FROM users"));
        assert!(!is_read_only_sql_query("DROP TABLE users"));
        assert!(!is_read_only_sql_query("ALTER TABLE users ADD col INT"));
        assert!(!is_read_only_sql_query("CREATE TABLE t (id INT)"));
    }

    #[test]
    fn test_read_only_redis_detection() {
        // Read-only commands should be allowed
        assert!(is_read_only_redis_command("GET mykey"));
        assert!(is_read_only_redis_command("  get mykey"));
        assert!(is_read_only_redis_command("MGET key1 key2"));
        assert!(is_read_only_redis_command("KEYS *"));
        assert!(is_read_only_redis_command("KEYS *harmony*"));
        assert!(is_read_only_redis_command("SCAN 0 MATCH * COUNT 100"));
        assert!(is_read_only_redis_command("LLEN queues:high"));
        assert!(is_read_only_redis_command("LRANGE mylist 0 -1"));
        assert!(is_read_only_redis_command("HGETALL myhash"));
        assert!(is_read_only_redis_command("SMEMBERS myset"));
        assert!(is_read_only_redis_command("ZRANGE myzset 0 -1"));
        assert!(is_read_only_redis_command("INFO"));
        assert!(is_read_only_redis_command("INFO server"));
        assert!(is_read_only_redis_command("DBSIZE"));
        assert!(is_read_only_redis_command("TTL mykey"));
        assert!(is_read_only_redis_command("TYPE mykey"));
        assert!(is_read_only_redis_command("EXISTS mykey"));
        assert!(is_read_only_redis_command("PING"));
        assert!(is_read_only_redis_command("XLEN mystream"));

        // Write commands should be blocked
        assert!(!is_read_only_redis_command("SET mykey value"));
        assert!(!is_read_only_redis_command("DEL mykey"));
        assert!(!is_read_only_redis_command("FLUSHDB"));
        assert!(!is_read_only_redis_command("FLUSHALL"));
        assert!(!is_read_only_redis_command("LPUSH mylist value"));
        assert!(!is_read_only_redis_command("RPUSH mylist value"));
        assert!(!is_read_only_redis_command("HSET myhash field value"));
        assert!(!is_read_only_redis_command("SADD myset member"));
        assert!(!is_read_only_redis_command("ZADD myzset 1 member"));
        assert!(!is_read_only_redis_command("EXPIRE mykey 100"));
        assert!(!is_read_only_redis_command("RENAME key1 key2"));
        assert!(!is_read_only_redis_command("MSET key1 v1 key2 v2"));
        assert!(!is_read_only_redis_command("INCR counter"));
        assert!(!is_read_only_redis_command("DECR counter"));
    }

    #[test]
    fn test_is_read_only_dispatches_by_db_type() {
        // SQL types use SQL validation
        assert!(is_read_only("postgres", "SELECT * FROM users"));
        assert!(!is_read_only("postgres", "LLEN mylist"));
        assert!(is_read_only("postgresql", "SELECT 1"));
        assert!(is_read_only("sqlite", "SELECT 1"));
        assert!(is_read_only("clickhouse", "SHOW TABLES"));

        // Redis uses Redis validation
        assert!(is_read_only("redis", "LLEN queues:high"));
        assert!(is_read_only("redis", "GET mykey"));
        assert!(is_read_only("redis", "KEYS *"));
        assert!(!is_read_only("redis", "SET mykey value"));
        assert!(!is_read_only("redis", "DEL mykey"));
    }
}
