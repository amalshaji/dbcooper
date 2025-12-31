use async_trait::async_trait;
use serde_json::{json, Value};
use sqlx::postgres::PgPoolOptions;
use sqlx::{Column, Row, TypeInfo};
use std::sync::Arc;
use tokio::sync::RwLock;

use super::{DatabaseDriver, PostgresConfig};
use crate::db::models::{
    ColumnInfo, ForeignKeyInfo, IndexInfo, QueryResult, SchemaOverview, TableDataResponse,
    TableInfo, TableStructure, TableWithStructure, TestConnectionResult,
};
use crate::database::queries::postgres::SCHEMA_OVERVIEW_QUERY;

pub struct PostgresDriver {
    config: PostgresConfig,
    pool: Arc<RwLock<Option<sqlx::PgPool>>>,
}

impl PostgresDriver {
    pub fn new(config: PostgresConfig) -> Self {
        Self {
            config,
            pool: Arc::new(RwLock::new(None)),
        }
    }

    fn build_connection_string(&self) -> String {
        let ssl_mode = if self.config.ssl {
            "require"
        } else {
            "disable"
        };
        format!(
            "postgres://{}:{}@{}:{}/{}?sslmode={}",
            self.config.username,
            self.config.password,
            self.config.host,
            self.config.port,
            self.config.database,
            ssl_mode
        )
    }

    async fn create_pool(&self) -> Result<sqlx::PgPool, String> {
        let conn_str = self.build_connection_string();
        
        // Use a 15 second timeout for connection (longer for SSH tunnel overhead)
        match tokio::time::timeout(
            std::time::Duration::from_secs(15),
            PgPoolOptions::new()
                .max_connections(5)
                .acquire_timeout(std::time::Duration::from_secs(30))
                .idle_timeout(std::time::Duration::from_secs(600))
                .test_before_acquire(true)
                .connect(&conn_str),
        )
        .await
        {
            Ok(Ok(pool)) => Ok(pool),
            Ok(Err(e)) => Err(format!("Failed to connect to PostgreSQL: {}", e)),
            Err(_) => Err("Connection timed out after 15 seconds".to_string()),
        }
    }

    async fn get_pool(&self) -> Result<sqlx::PgPool, String> {
        {
            let pool_guard = self.pool.read().await;
            if let Some(ref pool) = *pool_guard {
                return Ok(pool.clone());
            }
        }

        let mut pool_guard = self.pool.write().await;
        if let Some(ref pool) = *pool_guard {
            return Ok(pool.clone());
        }

        let new_pool = self.create_pool().await?;
        let pool_clone = new_pool.clone();
        *pool_guard = Some(new_pool);
        Ok(pool_clone)
    }

    async fn reset_pool(&self) -> Result<(), String> {
        let mut pool_guard = self.pool.write().await;
        if let Some(pool) = pool_guard.take() {
            pool.close().await;
        }
        Ok(())
    }

    async fn get_pool_with_retry(&self) -> Result<sqlx::PgPool, String> {
        match self.get_pool().await {
            Ok(pool) => Ok(pool),
            Err(e) => {
                println!("[Postgres] Pool initialization failed: {}, resetting...", e);
                self.reset_pool().await?;
                self.get_pool().await
            }
        }
    }

    fn row_to_json(row: &sqlx::postgres::PgRow) -> Value {
        let mut obj = serde_json::Map::new();
        for (i, col) in row.columns().iter().enumerate() {
            let type_name = col.type_info().name();
            let value: Value = match type_name {
                "INT2" => row
                    .try_get::<i16, _>(i)
                    .map(|v| json!(v))
                    .unwrap_or(Value::Null),
                "INT4" => row
                    .try_get::<i32, _>(i)
                    .map(|v| json!(v))
                    .unwrap_or(Value::Null),
                "INT8" => row
                    .try_get::<i64, _>(i)
                    .map(|v| json!(v))
                    .unwrap_or(Value::Null),
                "FLOAT4" => row
                    .try_get::<f32, _>(i)
                    .map(|v| json!(v))
                    .unwrap_or(Value::Null),
                "FLOAT8" | "NUMERIC" => row
                    .try_get::<f64, _>(i)
                    .map(|v| json!(v))
                    .unwrap_or(Value::Null),
                "BOOL" => row
                    .try_get::<bool, _>(i)
                    .map(|v| json!(v))
                    .unwrap_or(Value::Null),
                "TEXT" | "VARCHAR" | "CHAR" | "BPCHAR" | "NAME" => row
                    .try_get::<String, _>(i)
                    .map(|v| json!(v))
                    .unwrap_or(Value::Null),
                "UUID" => row
                    .try_get::<uuid::Uuid, _>(i)
                    .map(|v| json!(v.to_string()))
                    .unwrap_or(Value::Null),
                "TIMESTAMP" | "TIMESTAMPTZ" => row
                    .try_get::<chrono::NaiveDateTime, _>(i)
                    .map(|v| json!(v.to_string()))
                    .or_else(|_| {
                        row.try_get::<chrono::DateTime<chrono::Utc>, _>(i)
                            .map(|v| json!(v.to_string()))
                    })
                    .unwrap_or(Value::Null),
                "DATE" => row
                    .try_get::<chrono::NaiveDate, _>(i)
                    .map(|v| json!(v.to_string()))
                    .unwrap_or(Value::Null),
                "TIME" | "TIMETZ" => row
                    .try_get::<chrono::NaiveTime, _>(i)
                    .map(|v| json!(v.to_string()))
                    .unwrap_or(Value::Null),
                "JSON" | "JSONB" => row
                    .try_get::<serde_json::Value, _>(i)
                    .unwrap_or(Value::Null),
                "BYTEA" => row
                    .try_get::<Vec<u8>, _>(i)
                    .map(|v| json!(format!("\\x{}", hex::encode(&v))))
                    .unwrap_or(Value::Null),
                _ => row
                    .try_get::<String, _>(i)
                    .map(|v| json!(v))
                    .unwrap_or_else(|_| json!(format!("<{}>", type_name))),
            };
            obj.insert(col.name().to_string(), value);
        }
        Value::Object(obj)
    }
}

#[async_trait]
impl DatabaseDriver for PostgresDriver {
    async fn test_connection(&self) -> Result<TestConnectionResult, String> {
        match self.get_pool().await {
            Ok(pool) => {
                let result = sqlx::query("SELECT 1").fetch_one(&pool).await;
                match result {
                    Ok(_) => Ok(TestConnectionResult {
                        success: true,
                        message: "Connection successful!".to_string(),
                    }),
                    Err(e) => Ok(TestConnectionResult {
                        success: false,
                        message: format!("Connection failed: {}", e),
                    }),
                }
            }
            Err(e) => Ok(TestConnectionResult {
                success: false,
                message: format!("Connection failed: {}", e),
            }),
        }
    }

    async fn list_tables(&self) -> Result<Vec<TableInfo>, String> {
        let pool = self.get_pool_with_retry().await?;

        let tables = sqlx::query_as::<_, (String, String, String)>(
            r#"
            SELECT 
                table_schema as schema,
                table_name as name,
                CASE 
                    WHEN table_type = 'BASE TABLE' THEN 'table'
                    WHEN table_type = 'VIEW' THEN 'view'
                    ELSE 'table'
                END as type
            FROM information_schema.tables
            WHERE table_schema NOT IN ('pg_catalog', 'information_schema')
            ORDER BY table_schema, table_name
            "#,
        )
        .fetch_all(&pool)
        .await
        .map_err(|e| {
            let error_str = e.to_string();
            if error_str.contains("Connection reset by peer") 
                || error_str.contains("broken pipe")
                || error_str.contains("connection closed")
            {
                println!("[Postgres] Connection error in list_tables, will reset pool on next access: {}", error_str);
            }
            error_str
        })?;

        Ok(tables
            .into_iter()
            .map(|(schema, name, table_type)| TableInfo {
                schema,
                name,
                table_type,
            })
            .collect())
    }

    async fn get_table_data(
        &self,
        schema: &str,
        table: &str,
        page: i64,
        limit: i64,
        filter: Option<String>,
    ) -> Result<TableDataResponse, String> {
        let pool = self.get_pool_with_retry().await?;

        let offset = (page - 1) * limit;
        let full_table_name = format!("\"{}\".\"{}\"", schema, table);
        let where_clause = filter
            .as_ref()
            .map(|f| {
                // Normalize curly/smart quotes to regular ASCII quotes
                // macOS often auto-replaces straight quotes with smart quotes
                let normalized = f
                    .replace('\u{2018}', "'") // Left single quotation mark '
                    .replace('\u{2019}', "'") // Right single quotation mark '
                    .replace('\u{201C}', "\"") // Left double quotation mark "
                    .replace('\u{201D}', "\"") // Right double quotation mark "
                    .replace("\\'", "'"); // Backslash-escaped single quote
                format!(" WHERE {}", normalized)
            })
            .unwrap_or_default();

        let count_query = format!(
            "SELECT COUNT(*) as count FROM {}{}",
            full_table_name, where_clause
        );
        let count_row: (i64,) = sqlx::query_as(&count_query)
            .fetch_one(&pool)
            .await
            .map_err(|e| {
                let error_str = e.to_string();
                if error_str.contains("Connection reset by peer") 
                    || error_str.contains("broken pipe")
                    || error_str.contains("connection closed")
                {
                    println!("[Postgres] Connection error in get_table_data (count), will reset pool on next access: {}", error_str);
                }
                error_str
            })?;
        let total = count_row.0;

        let data_query = format!(
            "SELECT * FROM {}{} LIMIT {} OFFSET {}",
            full_table_name, where_clause, limit, offset
        );

        let rows = sqlx::query(&data_query)
            .fetch_all(&pool)
            .await
            .map_err(|e| {
                let error_str = e.to_string();
                if error_str.contains("Connection reset by peer") 
                    || error_str.contains("broken pipe")
                    || error_str.contains("connection closed")
                {
                    println!("[Postgres] Connection error in get_table_data (data), will reset pool on next access: {}", error_str);
                }
                error_str
            })?;

        let data: Vec<Value> = rows.iter().map(Self::row_to_json).collect();

        Ok(TableDataResponse {
            data,
            total,
            page,
            limit,
        })
    }

    async fn get_table_structure(
        &self,
        schema: &str,
        table: &str,
    ) -> Result<TableStructure, String> {
        let pool = self.get_pool_with_retry().await?;

        let columns = sqlx::query_as::<_, (String, String, bool, Option<String>, bool)>(
            r#"
            SELECT
                c.column_name as name,
                c.data_type as type,
                c.is_nullable = 'YES' as nullable,
                c.column_default as default,
                EXISTS(
                    SELECT 1 FROM information_schema.table_constraints tc
                    JOIN information_schema.key_column_usage kcu
                    ON tc.constraint_name = kcu.constraint_name
                    WHERE tc.table_schema = c.table_schema
                    AND tc.table_name = c.table_name
                    AND kcu.column_name = c.column_name
                    AND tc.constraint_type = 'PRIMARY KEY'
                ) as primary_key
            FROM information_schema.columns c
            WHERE c.table_schema = $1
            AND c.table_name = $2
            ORDER BY c.ordinal_position
            "#,
        )
        .bind(schema)
        .bind(table)
        .fetch_all(&pool)
        .await
        .map_err(|e| {
            let error_str = e.to_string();
            if error_str.contains("Connection reset by peer") 
                || error_str.contains("broken pipe")
                || error_str.contains("connection closed")
            {
                println!("[Postgres] Connection error in get_table_structure, will reset pool on next access: {}", error_str);
            }
            error_str
        })?;

        let indexes = sqlx::query_as::<_, (String, Vec<String>, bool, bool)>(
            r#"
            SELECT
                i.indexname as name,
                array_agg(a.attname)::text[] as columns,
                idx.indisunique as unique,
                idx.indisprimary as primary
            FROM pg_indexes i
            JOIN pg_class c ON c.relname = i.indexname
            JOIN pg_index idx ON idx.indexrelid = c.oid
            JOIN pg_attribute a ON a.attrelid = idx.indrelid AND a.attnum = ANY(idx.indkey)
            WHERE i.schemaname = $1
            AND i.tablename = $2
            GROUP BY i.indexname, idx.indisunique, idx.indisprimary
            "#,
        )
        .bind(schema)
        .bind(table)
        .fetch_all(&pool)
        .await
        .map_err(|e| {
            let error_str = e.to_string();
            if error_str.contains("Connection reset by peer") 
                || error_str.contains("broken pipe")
                || error_str.contains("connection closed")
            {
                println!("[Postgres] Connection error in get_table_structure, will reset pool on next access: {}", error_str);
            }
            error_str
        })?;

        let foreign_keys = sqlx::query_as::<_, (String, String, String, String)>(
            r#"
            SELECT
                tc.constraint_name as name,
                kcu.column_name as column,
                ccu.table_name as references_table,
                ccu.column_name as references_column
            FROM information_schema.table_constraints tc
            JOIN information_schema.key_column_usage kcu
            ON tc.constraint_name = kcu.constraint_name
            JOIN information_schema.constraint_column_usage ccu
            ON tc.constraint_name = ccu.constraint_name
            WHERE tc.constraint_type = 'FOREIGN KEY'
            AND tc.table_schema = $1
            AND tc.table_name = $2
            "#,
        )
        .bind(schema)
        .bind(table)
        .fetch_all(&pool)
        .await
        .map_err(|e| {
            let error_str = e.to_string();
            if error_str.contains("Connection reset by peer") 
                || error_str.contains("broken pipe")
                || error_str.contains("connection closed")
            {
                println!("[Postgres] Connection error in get_table_structure, will reset pool on next access: {}", error_str);
            }
            error_str
        })?;

        Ok(TableStructure {
            columns: columns
                .into_iter()
                .map(
                    |(name, data_type, nullable, default, primary_key)| ColumnInfo {
                        name,
                        data_type,
                        nullable,
                        default,
                        primary_key,
                    },
                )
                .collect(),
            indexes: indexes
                .into_iter()
                .map(|(name, columns, unique, primary)| IndexInfo {
                    name,
                    columns,
                    unique,
                    primary,
                })
                .collect(),
            foreign_keys: foreign_keys
                .into_iter()
                .map(
                    |(name, column, references_table, references_column)| ForeignKeyInfo {
                        name,
                        column,
                        references_table,
                        references_column,
                    },
                )
                .collect(),
        })
    }

    async fn execute_query(&self, query: &str) -> Result<QueryResult, String> {
        let start_time = std::time::Instant::now();
        let pool = self.get_pool_with_retry().await?;

        match sqlx::query(query).fetch_all(&pool).await {
            Ok(rows) => {
                let data: Vec<Value> = rows.iter().map(Self::row_to_json).collect();
                let row_count = data.len() as i64;
                Ok(QueryResult {
                    data,
                    row_count,
                    error: None,
                    time_taken_ms: Some(start_time.elapsed().as_millis()),
                })
            }
            Err(e) => {
                let error_str = e.to_string();
                let should_reset = error_str.contains("Connection reset by peer")
                    || error_str.contains("broken pipe")
                    || error_str.contains("connection closed")
                    || error_str.contains("server closed the connection");

                if should_reset {
                    println!(
                        "[Postgres] Connection error detected, resetting pool: {}",
                        error_str
                    );
                    let _ = self.reset_pool().await;
                }

                Ok(QueryResult {
                    data: vec![],
                    row_count: 0,
                    error: Some(error_str),
                    time_taken_ms: Some(start_time.elapsed().as_millis()),
                })
            }
        }
    }

    async fn get_schema_overview(&self) -> Result<SchemaOverview, String> {
        let pool = self.get_pool_with_retry().await?;

        let rows = sqlx::query(SCHEMA_OVERVIEW_QUERY)
            .fetch_all(&pool)
            .await
            .map_err(|e| {
                let error_str = e.to_string();
                if error_str.contains("Connection reset by peer")
                    || error_str.contains("broken pipe")
                    || error_str.contains("connection closed")
                {
                    println!(
                        "[Postgres] Connection error in get_schema_overview, will reset pool on next access: {}",
                        error_str
                    );
                }
                error_str
            })?;

        let mut tables = Vec::new();

        for row in rows {
            let schema: String = row.try_get("schema").map_err(|e| e.to_string())?;
            let name: String = row.try_get("name").map_err(|e| e.to_string())?;
            let table_type: String = row.try_get("type").map_err(|e| e.to_string())?;

            let columns_json: Value = row.try_get("columns").map_err(|e| e.to_string())?;
            let columns: Vec<ColumnInfo> = serde_json::from_value(columns_json)
                .map_err(|e| format!("Failed to parse columns: {}", e))?;

            let foreign_keys_json: Value = row.try_get("foreign_keys").map_err(|e| e.to_string())?;
            let foreign_keys: Vec<ForeignKeyInfo> = serde_json::from_value(foreign_keys_json)
                .map_err(|e| format!("Failed to parse foreign_keys: {}", e))?;

            let indexes_json: Value = row.try_get("indexes").map_err(|e| e.to_string())?;
            let indexes: Vec<IndexInfo> = serde_json::from_value(indexes_json)
                .map_err(|e| format!("Failed to parse indexes: {}", e))?;

            tables.push(TableWithStructure {
                schema,
                name,
                table_type,
                columns,
                foreign_keys,
                indexes,
            });
        }

        Ok(SchemaOverview { tables })
    }
}
