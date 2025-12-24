use async_trait::async_trait;
use redis::AsyncCommands;
use serde_json::{json, Value};

use super::{DatabaseDriver, RedisConfig};
use crate::db::models::{
    QueryResult, TableDataResponse, TableInfo, TableStructure, TestConnectionResult,
};
use crate::ssh_tunnel::SshTunnel;

/// Redis-specific types for key values
#[derive(Debug, Clone, serde::Serialize)]
pub struct RedisKeyInfo {
    pub key: String,
    pub key_type: String,
    pub ttl: i64,
    pub size: Option<usize>,
}

/// Redis key details with value
#[derive(Debug, Clone, serde::Serialize)]
pub struct RedisKeyDetails {
    pub key: String,
    pub key_type: String,
    pub ttl: i64,
    pub value: serde_json::Value,
    pub encoding: Option<String>,
    pub size: Option<usize>,
    pub length: Option<usize>,
}

/// Result of a Redis pattern search
#[derive(Debug, Clone, serde::Serialize)]
pub struct RedisKeyListResponse {
    pub keys: Vec<RedisKeyInfo>,
    pub total: i64,
    pub time_taken_ms: Option<u128>,
}

pub struct RedisDriver {
    config: RedisConfig,
}

impl RedisDriver {
    pub fn new(config: RedisConfig) -> Self {
        Self { config }
    }

    /// Build Redis connection string
    fn build_connection_string(&self) -> String {
        let mut auth = String::new();
        if let Some(password) = &self.config.password {
            if !password.is_empty() {
                auth = format!(":{}@", password);
            }
        }

        let db = self.config.db.unwrap_or(0);
        let scheme = if self.config.tls { "rediss" } else { "redis" };

        format!(
            "{}://{}{}:{}/{}",
            scheme, auth, self.config.host, self.config.port, db
        )
    }

    /// Create a Redis client connection with timeout
    async fn get_connection(&self) -> Result<redis::aio::MultiplexedConnection, String> {
        let client = redis::Client::open(self.build_connection_string())
            .map_err(|e| format!("Failed to create Redis client: {}", e))?;

        // Use a 10 second timeout for connection
        match tokio::time::timeout(
            std::time::Duration::from_secs(10),
            client.get_multiplexed_async_connection(),
        )
        .await
        {
            Ok(Ok(conn)) => Ok(conn),
            Ok(Err(e)) => Err(format!("Failed to connect to Redis: {}", e)),
            Err(_) => Err("Connection timed out after 10 seconds".to_string()),
        }
    }

    /// Get connection string for SSH tunnel
    fn build_connection_string_with_host(&self, host: &str, port: u16) -> String {
        let mut auth = String::new();
        if let Some(password) = &self.config.password {
            if !password.is_empty() {
                auth = format!(":{}@", password);
            }
        }

        let db = self.config.db.unwrap_or(0);
        let scheme = if self.config.tls { "rediss" } else { "redis" };

        format!("{}://{}{}:{}/{}", scheme, auth, host, port, db)
    }

    /// Create connection with SSH tunnel support
    #[allow(dead_code)]
    async fn get_connection_with_tunnel(
        &self,
        tunnel: &SshTunnel,
    ) -> Result<redis::aio::MultiplexedConnection, String> {
        let conn_str = self.build_connection_string_with_host("127.0.0.1", tunnel.local_port);

        let client = redis::Client::open(conn_str)
            .map_err(|e| format!("Failed to create Redis client: {}", e))?;

        client
            .get_multiplexed_async_connection()
            .await
            .map_err(|e| format!("Failed to connect to Redis through tunnel: {}", e))
    }

    /// Convert Redis value to JSON
    fn redis_value_to_json(value: &redis::Value, _key_type: &str) -> Value {
        match value {
            redis::Value::Nil => json!(null),
            redis::Value::SimpleString(s) => json!(s),
            redis::Value::BulkString(bytes) => match String::from_utf8(bytes.clone()) {
                Ok(s) => json!(s),
                Err(_) => json!(format!("<binary data: {} bytes>", bytes.len())),
            },
            redis::Value::Array(arr) => {
                let values: Vec<Value> = arr
                    .iter()
                    .map(|v| Self::redis_value_to_json(v, _key_type))
                    .collect();
                json!(values)
            }
            redis::Value::Int(i) => json!(i),
            redis::Value::Double(d) => json!(d),
            redis::Value::Map(map) => {
                let obj = serde_json::Map::from_iter(map.iter().filter_map(|(k, v)| {
                    match k {
                        redis::Value::BulkString(bytes) => String::from_utf8(bytes.clone())
                            .ok()
                            .map(|key| (key, Self::redis_value_to_json(v, _key_type))),
                        _ => None,
                    }
                }));
                json!(obj)
            }
            redis::Value::Set(set) => {
                let values: Vec<Value> = set
                    .iter()
                    .map(|v| Self::redis_value_to_json(v, _key_type))
                    .collect();
                json!(values)
            }
            _ => json!("<unknown type>"),
        }
    }

    /// Get the size/length of a Redis value
    #[allow(dead_code)]
    fn get_value_length(value: &redis::Value, _key_type: &str) -> Option<usize> {
        match value {
            redis::Value::BulkString(bytes) => Some(bytes.len()),
            redis::Value::Array(arr) => Some(arr.len()),
            redis::Value::Map(map) => Some(map.len()),
            redis::Value::Set(set) => Some(set.len()),
            _ => None,
        }
    }
}

#[async_trait]
impl DatabaseDriver for RedisDriver {
    async fn test_connection(&self) -> Result<TestConnectionResult, String> {
        let _conn = self.get_connection().await?;

        Ok(TestConnectionResult {
            success: true,
            message: "Connection successful!".to_string(),
        })
    }

    async fn list_tables(&self) -> Result<Vec<TableInfo>, String> {
        // Redis doesn't have tables, return key count as "info"
        Ok(vec![TableInfo {
            schema: "redis".to_string(),
            name: "keys".to_string(),
            table_type: "keyspace".to_string(),
        }])
    }

    async fn get_table_data(
        &self,
        _schema: &str,
        _table: &str,
        _page: i64,
        _limit: i64,
        _filter: Option<String>,
    ) -> Result<TableDataResponse, String> {
        // Not applicable for Redis - use search_keys instead
        Ok(TableDataResponse {
            data: vec![],
            total: 0,
            page: 1,
            limit: 100,
        })
    }

    async fn get_table_structure(
        &self,
        _schema: &str,
        _table: &str,
    ) -> Result<TableStructure, String> {
        // Redis doesn't have table structure
        Ok(TableStructure {
            columns: vec![],
            indexes: vec![],
            foreign_keys: vec![],
        })
    }

    async fn execute_query(&self, query: &str) -> Result<QueryResult, String> {
        // For Redis, this is primarily for INFO and other commands
        let start_time = std::time::Instant::now();
        let mut conn = self.get_connection().await?;

        let trimmed_query = query.trim();

        // Handle INFO command
        if trimmed_query.to_uppercase().starts_with("INFO") {
            let info: String = redis::cmd("INFO")
                .arg(trimmed_query.strip_prefix("INFO").unwrap_or(""))
                .query_async(&mut conn)
                .await
                .map_err(|e| format!("Redis INFO command failed: {}", e))?;

            return Ok(QueryResult {
                data: vec![json!({"info": info})],
                row_count: 1,
                error: None,
                time_taken_ms: Some(start_time.elapsed().as_millis()),
            });
        }

        // Try to execute as raw Redis command
        let parts: Vec<&str> = trimmed_query.split_whitespace().collect();
        if parts.is_empty() {
            return Ok(QueryResult {
                data: vec![],
                row_count: 0,
                error: Some("Empty query".to_string()),
                time_taken_ms: Some(start_time.elapsed().as_millis()),
            });
        }

        let mut cmd = redis::cmd(parts[0]);
        for part in &parts[1..] {
            cmd.arg(*part);
        }

        match cmd.query_async(&mut conn).await {
            Ok(value) => {
                let json_value = Self::redis_value_to_json(&value, "unknown");
                Ok(QueryResult {
                    data: vec![json_value],
                    row_count: 1,
                    error: None,
                    time_taken_ms: Some(start_time.elapsed().as_millis()),
                })
            }
            Err(e) => Ok(QueryResult {
                data: vec![],
                row_count: 0,
                error: Some(format!("Redis command failed: {}", e)),
                time_taken_ms: Some(start_time.elapsed().as_millis()),
            }),
        }
    }
}

impl RedisDriver {
    /// Search for keys matching a pattern using SCAN (non-blocking)
    /// Returns only key names for fast initial loading - metadata is fetched on demand via get_key_details
    pub async fn search_keys(
        &self,
        pattern: &str,
        limit: i64,
    ) -> Result<RedisKeyListResponse, String> {
        let start_time = std::time::Instant::now();
        let mut conn = self.get_connection().await?;

        // Use SCAN instead of KEYS for better performance on large keyspaces
        // SCAN is non-blocking and iterates incrementally
        let mut keys: Vec<String> = Vec::new();
        let mut cursor: u64 = 0;
        let count_per_scan = 100; // Number of keys to scan per iteration

        loop {
            let (new_cursor, batch): (u64, Vec<String>) = redis::cmd("SCAN")
                .arg(cursor)
                .arg("MATCH")
                .arg(pattern)
                .arg("COUNT")
                .arg(count_per_scan)
                .query_async(&mut conn)
                .await
                .map_err(|e| format!("Failed to scan keys: {}", e))?;

            keys.extend(batch);
            cursor = new_cursor;

            // Stop if we've reached the limit or completed the scan
            if cursor == 0 || keys.len() >= limit as usize {
                break;
            }
        }

        // Apply limit and create key infos with placeholder values
        // Actual metadata (type, ttl, size) is fetched lazily via get_key_details
        let key_infos: Vec<RedisKeyInfo> = keys
            .into_iter()
            .take(limit as usize)
            .map(|key| RedisKeyInfo {
                key,
                key_type: "".to_string(), // Loaded on demand
                ttl: -2,                  // -2 indicates not yet loaded
                size: None,
            })
            .collect();

        Ok(RedisKeyListResponse {
            total: key_infos.len() as i64,
            keys: key_infos,
            time_taken_ms: Some(start_time.elapsed().as_millis()),
        })
    }

    /// Get detailed information about a specific key
    pub async fn get_key_details(&self, key: &str) -> Result<RedisKeyDetails, String> {
        let mut conn = self.get_connection().await?;

        // Check if key exists
        let exists: bool = conn.exists(key).await.unwrap_or(false);
        if !exists {
            return Err(format!("Key '{}' does not exist", key));
        }

        // Get key type
        let key_type: String = conn.key_type(key).await.map_err(|e| e.to_string())?;

        // Get TTL
        let ttl: i64 = conn.ttl(key).await.unwrap_or(-1);

        // Get value based on type
        let value = match key_type.as_str() {
            "string" => {
                let val: Option<String> = conn.get(key).await.unwrap_or(None);
                json!(val)
            }
            "list" => {
                let val: Vec<String> = conn.lrange(key, 0, -1).await.unwrap_or_default();
                json!(val)
            }
            "set" => {
                let val: Vec<String> = conn.smembers(key).await.unwrap_or_default();
                json!(val)
            }
            "zset" => {
                let val: Vec<(String, f64)> =
                    conn.zrange_withscores(key, 0, -1).await.unwrap_or_default();
                json!(val)
            }
            "hash" => {
                let val: std::collections::HashMap<String, String> =
                    conn.hgetall(key).await.unwrap_or_default();
                json!(val)
            }
            "stream" => {
                // Streams are complex, return a placeholder
                json!("<stream data - use XREAD command>")
            }
            _ => json!(null),
        };

        // Get memory usage
        let size = redis::cmd("MEMORY")
            .arg("USAGE")
            .arg(key)
            .query_async::<i64>(&mut conn)
            .await
            .ok()
            .map(|s| s as usize);

        // Get length/size based on type
        let length = match key_type.as_str() {
            "string" => {
                let val: Option<String> = conn.get(key).await.unwrap_or(None);
                val.map(|v| v.len())
            }
            "list" => conn.llen(key).await.ok(),
            "set" => conn.scard(key).await.ok().map(|c: usize| c),
            "zset" => conn.zcard(key).await.ok().map(|c: usize| c),
            "hash" => conn.hlen(key).await.ok().map(|c: usize| c),
            _ => None,
        };

        // Get encoding
        let encoding = redis::cmd("OBJECT")
            .arg("ENCODING")
            .arg(key)
            .query_async::<String>(&mut conn)
            .await
            .ok();

        Ok(RedisKeyDetails {
            key: key.to_string(),
            key_type,
            ttl,
            value,
            encoding,
            size,
            length,
        })
    }

    /// Delete a key
    pub async fn delete_key(&self, key: &str) -> Result<bool, String> {
        let mut conn = self.get_connection().await?;

        let deleted: i64 = conn.del(key).await.map_err(|e| e.to_string())?;

        Ok(deleted > 0)
    }

    /// Set a key value (for string types)
    pub async fn set_key(&self, key: &str, value: &str, ttl: Option<i64>) -> Result<(), String> {
        let mut conn = self.get_connection().await?;

        if let Some(expiry) = ttl {
            let _: String = conn
                .set_ex(key, value, expiry as u64)
                .await
                .map_err(|e| e.to_string())?;
        } else {
            let _: String = conn.set(key, value).await.map_err(|e| e.to_string())?;
        }

        Ok(())
    }
}

/// Redis driver with SSH tunnel support
impl RedisDriver {
    /// Create a new Redis driver with SSH tunnel
    pub async fn with_ssh_tunnel(
        config: RedisConfig,
        ssh_host: &str,
        ssh_port: u16,
        ssh_user: &str,
        ssh_password: Option<&str>,
        ssh_key_path: Option<&str>,
        ssh_use_key: bool,
    ) -> Result<(Self, SshTunnel), String> {
        let driver = Self::new(config.clone());

        let key_path = if ssh_use_key {
            if let Some(key) = ssh_key_path {
                if !key.is_empty() {
                    // Expand ~ to home directory
                    if key.starts_with("~") {
                        if let Some(home) = dirs::home_dir() {
                            Some(key.replacen("~", home.to_str().unwrap_or(""), 1))
                        } else {
                            Some(key.to_string())
                        }
                    } else {
                        Some(key.to_string())
                    }
                } else {
                    None
                }
            } else {
                None
            }
        } else {
            None
        };

        let password_opt = if !ssh_use_key { ssh_password } else { None };

        let tunnel = SshTunnel::new(
            ssh_host,
            ssh_port,
            ssh_user,
            password_opt,
            key_path.as_deref(),
            &config.host,
            config.port as u16,
        )
        .await?;

        Ok((driver, tunnel))
    }

    /// Search keys through SSH tunnel using SCAN (non-blocking)
    /// Returns only key names for fast initial loading - metadata is fetched on demand
    pub async fn search_keys_with_tunnel(
        &self,
        tunnel: &SshTunnel,
        pattern: &str,
        limit: i64,
    ) -> Result<RedisKeyListResponse, String> {
        let start_time = std::time::Instant::now();
        let conn_str = self.build_connection_string_with_host("127.0.0.1", tunnel.local_port);

        let client = redis::Client::open(conn_str)
            .map_err(|e| format!("Failed to create Redis client: {}", e))?;

        let mut conn = client
            .get_multiplexed_async_connection()
            .await
            .map_err(|e| format!("Failed to connect to Redis: {}", e))?;

        // Use SCAN instead of KEYS for better performance on large keyspaces
        let mut keys: Vec<String> = Vec::new();
        let mut cursor: u64 = 0;
        let count_per_scan = 100;

        loop {
            let (new_cursor, batch): (u64, Vec<String>) = redis::cmd("SCAN")
                .arg(cursor)
                .arg("MATCH")
                .arg(pattern)
                .arg("COUNT")
                .arg(count_per_scan)
                .query_async(&mut conn)
                .await
                .map_err(|e| format!("Failed to scan keys: {}", e))?;

            keys.extend(batch);
            cursor = new_cursor;

            if cursor == 0 || keys.len() >= limit as usize {
                break;
            }
        }

        // Apply limit and create key infos with placeholder values
        // Actual metadata is fetched lazily via get_key_details_with_tunnel
        let key_infos: Vec<RedisKeyInfo> = keys
            .into_iter()
            .take(limit as usize)
            .map(|key| RedisKeyInfo {
                key,
                key_type: "".to_string(),
                ttl: -2,
                size: None,
            })
            .collect();

        Ok(RedisKeyListResponse {
            total: key_infos.len() as i64,
            keys: key_infos,
            time_taken_ms: Some(start_time.elapsed().as_millis()),
        })
    }

    /// Get key details through SSH tunnel
    pub async fn get_key_details_with_tunnel(
        &self,
        tunnel: &SshTunnel,
        key: &str,
    ) -> Result<RedisKeyDetails, String> {
        let conn_str = self.build_connection_string_with_host("127.0.0.1", tunnel.local_port);

        let client = redis::Client::open(conn_str)
            .map_err(|e| format!("Failed to create Redis client: {}", e))?;

        let mut conn = client
            .get_multiplexed_async_connection()
            .await
            .map_err(|e| format!("Failed to connect to Redis: {}", e))?;

        let exists: bool = conn.exists(key).await.unwrap_or(false);
        if !exists {
            return Err(format!("Key '{}' does not exist", key));
        }

        let key_type: String = conn.key_type(key).await.map_err(|e| e.to_string())?;
        let ttl: i64 = conn.ttl(key).await.unwrap_or(-1);

        let value = match key_type.as_str() {
            "string" => {
                let val: Option<String> = conn.get(key).await.unwrap_or(None);
                json!(val)
            }
            "list" => {
                let val: Vec<String> = conn.lrange(key, 0, -1).await.unwrap_or_default();
                json!(val)
            }
            "set" => {
                let val: Vec<String> = conn.smembers(key).await.unwrap_or_default();
                json!(val)
            }
            "zset" => {
                let val: Vec<(String, f64)> =
                    conn.zrange_withscores(key, 0, -1).await.unwrap_or_default();
                json!(val)
            }
            "hash" => {
                let val: std::collections::HashMap<String, String> =
                    conn.hgetall(key).await.unwrap_or_default();
                json!(val)
            }
            _ => json!(null),
        };

        let size = redis::cmd("MEMORY")
            .arg("USAGE")
            .arg(key)
            .query_async::<i64>(&mut conn)
            .await
            .ok()
            .map(|s| s as usize);

        let length = match key_type.as_str() {
            "string" => {
                let val: Option<String> = conn.get(key).await.unwrap_or(None);
                val.map(|v| v.len())
            }
            "list" => conn.llen(key).await.ok(),
            "set" => conn.scard(key).await.ok().map(|c: usize| c),
            "zset" => conn.zcard(key).await.ok().map(|c: usize| c),
            "hash" => conn.hlen(key).await.ok().map(|c: usize| c),
            _ => None,
        };

        let encoding = redis::cmd("OBJECT")
            .arg("ENCODING")
            .arg(key)
            .query_async::<String>(&mut conn)
            .await
            .ok();

        Ok(RedisKeyDetails {
            key: key.to_string(),
            key_type,
            ttl,
            value,
            encoding,
            size,
            length,
        })
    }

    /// Test connection through SSH tunnel
    #[allow(dead_code)]
    pub async fn test_connection_with_tunnel(
        &self,
        tunnel: &SshTunnel,
    ) -> Result<TestConnectionResult, String> {
        let conn_str = self.build_connection_string_with_host("127.0.0.1", tunnel.local_port);

        let client = redis::Client::open(conn_str)
            .map_err(|e| format!("Failed to create Redis client: {}", e))?;

        let mut conn = client
            .get_multiplexed_async_connection()
            .await
            .map_err(|e| format!("Failed to connect to Redis: {}", e))?;

        // Test with PING
        let _: String = redis::cmd("PING")
            .query_async(&mut conn)
            .await
            .map_err(|e| format!("Redis PING failed: {}", e))?;

        Ok(TestConnectionResult {
            success: true,
            message: "Connection successful!".to_string(),
        })
    }
}
