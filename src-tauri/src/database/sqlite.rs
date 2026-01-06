use async_trait::async_trait;
use serde_json::{json, Value};
use sqlx::sqlite::SqlitePoolOptions;
use sqlx::{Column, Row, TypeInfo};

use super::{DatabaseDriver, SqliteConfig};
use crate::database::queries::sqlite::{
    COLUMNS_QUERY, FOREIGN_KEYS_QUERY, INDEXES_QUERY, TABLES_QUERY,
};
use crate::db::models::{
    ColumnInfo, ForeignKeyInfo, IndexInfo, QueryResult, SchemaOverview, TableDataResponse,
    TableInfo, TableStructure, TableWithStructure, TestConnectionResult,
};
use std::collections::HashMap;

pub struct SqliteDriver {
    config: SqliteConfig,
}

impl SqliteDriver {
    pub fn new(config: SqliteConfig) -> Self {
        Self { config }
    }

    fn connection_string(&self) -> String {
        format!("sqlite:{}?mode=rwc", self.config.file_path)
    }

    async fn get_pool(&self) -> Result<sqlx::SqlitePool, String> {
        let conn_str = self.connection_string();
        SqlitePoolOptions::new()
            .max_connections(1)
            .connect(&conn_str)
            .await
            .map_err(|e| e.to_string())
    }

    fn row_to_json(row: &sqlx::sqlite::SqliteRow) -> Value {
        let mut obj = serde_json::Map::new();
        for (i, col) in row.columns().iter().enumerate() {
            let type_name = col.type_info().name().to_uppercase();
            let value: Value = match type_name.as_str() {
                "INTEGER" => row
                    .try_get::<i64, _>(i)
                    .map(|v| json!(v))
                    .unwrap_or(Value::Null),
                "REAL" => row
                    .try_get::<f64, _>(i)
                    .map(|v| json!(v))
                    .unwrap_or(Value::Null),
                "TEXT" => row
                    .try_get::<String, _>(i)
                    .map(|v| json!(v))
                    .unwrap_or(Value::Null),
                "BLOB" => row
                    .try_get::<Vec<u8>, _>(i)
                    .map(|v| json!(format!("[{} bytes]", v.len())))
                    .unwrap_or(Value::Null),
                // NULL type can mean either an actual NULL value or an expression result like COUNT(*)
                // Try to extract as various types before giving up
                "NULL" => row
                    .try_get::<i64, _>(i)
                    .map(|v| json!(v))
                    .or_else(|_| row.try_get::<f64, _>(i).map(|v| json!(v)))
                    .or_else(|_| row.try_get::<String, _>(i).map(|v| json!(v)))
                    .unwrap_or(Value::Null),

                "BOOLEAN" | "BOOL" => row
                    .try_get::<bool, _>(i)
                    .map(|v| json!(v))
                    .or_else(|_| row.try_get::<i64, _>(i).map(|v| json!(v != 0)))
                    .unwrap_or(Value::Null),
                // Handle datetime types - SQLite stores these as TEXT, REAL, or INTEGER
                "DATETIME" | "DATE" | "TIME" | "TIMESTAMP" => row
                    .try_get::<String, _>(i)
                    .map(|v| json!(v))
                    .or_else(|_| row.try_get::<f64, _>(i).map(|v| json!(v.to_string())))
                    .or_else(|_| row.try_get::<i64, _>(i).map(|v| json!(v.to_string())))
                    .unwrap_or(Value::Null),
                _ => {
                    // For unknown types (like COUNT(*) which returns NULL type),
                    // try extracting as different types in order of likelihood
                    let int_result = row.try_get::<i64, _>(i);
                    eprintln!(
                        "DEBUG: fallback type={}, col={}, int_try={:?}",
                        type_name,
                        col.name(),
                        int_result
                    );
                    int_result
                        .map(|v| json!(v))
                        .or_else(|_| row.try_get::<f64, _>(i).map(|v| json!(v)))
                        .or_else(|_| row.try_get::<String, _>(i).map(|v| json!(v)))
                        .or_else(|_| row.try_get::<bool, _>(i).map(|v| json!(v)))
                        .unwrap_or(Value::Null)
                }
            };
            obj.insert(col.name().to_string(), value);
        }
        Value::Object(obj)
    }
}

#[async_trait]
impl DatabaseDriver for SqliteDriver {
    async fn test_connection(&self) -> Result<TestConnectionResult, String> {
        match self.get_pool().await {
            Ok(pool) => {
                let result = sqlx::query("SELECT 1").fetch_one(&pool).await;
                pool.close().await;
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
        let pool = self.get_pool().await?;

        // SQLite doesn't have schemas, so we use "main" as the default schema
        let tables = sqlx::query_as::<_, (String, String)>(
            r#"
            SELECT 
                name,
                type
            FROM sqlite_master
            WHERE type IN ('table', 'view')
            AND name NOT LIKE 'sqlite_%'
            ORDER BY name
            "#,
        )
        .fetch_all(&pool)
        .await
        .map_err(|e| e.to_string())?;

        pool.close().await;

        Ok(tables
            .into_iter()
            .map(|(name, table_type)| TableInfo {
                schema: "main".to_string(),
                name,
                table_type,
            })
            .collect())
    }

    async fn get_table_data(
        &self,
        _schema: &str, // SQLite doesn't use schemas
        table: &str,
        page: i64,
        limit: i64,
        filter: Option<String>,
        sort_column: Option<String>,
        sort_direction: Option<String>,
    ) -> Result<TableDataResponse, String> {
        let pool = self.get_pool().await?;

        let offset = (page - 1) * limit;
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

        let order_clause = sort_column
            .as_ref()
            .map(|col| {
                let dir = sort_direction.as_deref().unwrap_or("asc");
                format!(" ORDER BY \"{}\" {}", col, dir.to_uppercase())
            })
            .unwrap_or_default();

        let count_query = format!(
            "SELECT COUNT(*) as count FROM \"{}\"{}",
            table, where_clause
        );
        let count_row: (i64,) = sqlx::query_as(&count_query)
            .fetch_one(&pool)
            .await
            .map_err(|e| e.to_string())?;
        let total = count_row.0;

        let data_query = format!(
            "SELECT * FROM \"{}\"{}{} LIMIT {} OFFSET {}",
            table, where_clause, order_clause, limit, offset
        );

        let rows = sqlx::query(&data_query)
            .fetch_all(&pool)
            .await
            .map_err(|e| e.to_string())?;

        pool.close().await;

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
        _schema: &str, // SQLite doesn't use schemas
        table: &str,
    ) -> Result<TableStructure, String> {
        let pool = self.get_pool().await?;

        // Get columns using PRAGMA
        let pragma_query = format!("PRAGMA table_info(\"{}\")", table);
        let columns_raw = sqlx::query(&pragma_query)
            .fetch_all(&pool)
            .await
            .map_err(|e| e.to_string())?;

        let columns: Vec<ColumnInfo> = columns_raw
            .iter()
            .map(|row| {
                let name: String = row.try_get("name").unwrap_or_default();
                let data_type: String = row
                    .try_get::<String, _>("type")
                    .unwrap_or_default()
                    .to_uppercase();
                let notnull: i32 = row.try_get("notnull").unwrap_or(0);
                let default: Option<String> = row.try_get("dflt_value").ok();
                let pk: i32 = row.try_get("pk").unwrap_or(0);

                ColumnInfo {
                    name,
                    data_type,
                    nullable: notnull == 0,
                    default,
                    primary_key: pk > 0,
                }
            })
            .collect();

        // Get indexes using PRAGMA
        let index_list_query = format!("PRAGMA index_list(\"{}\")", table);
        let indexes_raw = sqlx::query(&index_list_query)
            .fetch_all(&pool)
            .await
            .map_err(|e| e.to_string())?;

        let mut indexes: Vec<IndexInfo> = Vec::new();
        for idx_row in &indexes_raw {
            let idx_name: String = idx_row.try_get("name").unwrap_or_default();
            let unique: i32 = idx_row.try_get("unique").unwrap_or(0);
            let origin: String = idx_row.try_get("origin").unwrap_or_default();

            // Get columns for this index
            let idx_info_query = format!("PRAGMA index_info(\"{}\")", idx_name);
            let idx_cols = sqlx::query(&idx_info_query)
                .fetch_all(&pool)
                .await
                .map_err(|e| e.to_string())?;

            let columns: Vec<String> = idx_cols
                .iter()
                .filter_map(|row| row.try_get::<String, _>("name").ok())
                .collect();

            indexes.push(IndexInfo {
                name: idx_name,
                columns,
                unique: unique == 1,
                primary: origin == "pk",
            });
        }

        // Get foreign keys using PRAGMA
        let fk_query = format!("PRAGMA foreign_key_list(\"{}\")", table);
        let fks_raw = sqlx::query(&fk_query)
            .fetch_all(&pool)
            .await
            .map_err(|e| e.to_string())?;

        let foreign_keys: Vec<ForeignKeyInfo> = fks_raw
            .iter()
            .map(|row| {
                let id: i32 = row.try_get("id").unwrap_or(0);
                let from_col: String = row.try_get("from").unwrap_or_default();
                let to_table: String = row.try_get("table").unwrap_or_default();
                let to_col: String = row.try_get("to").unwrap_or_default();

                ForeignKeyInfo {
                    name: format!("fk_{}", id),
                    column: from_col,
                    references_table: to_table,
                    references_column: to_col,
                }
            })
            .collect();

        pool.close().await;

        Ok(TableStructure {
            columns,
            indexes,
            foreign_keys,
        })
    }

    async fn execute_query(&self, query: &str) -> Result<QueryResult, String> {
        let start_time = std::time::Instant::now();
        let pool = self.get_pool().await?;

        match sqlx::query(query).fetch_all(&pool).await {
            Ok(rows) => {
                pool.close().await;
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
                pool.close().await;
                Ok(QueryResult {
                    data: vec![],
                    row_count: 0,
                    error: Some(e.to_string()),
                    time_taken_ms: Some(start_time.elapsed().as_millis()),
                })
            }
        }
    }

    async fn get_schema_overview(&self) -> Result<SchemaOverview, String> {
        let pool = self.get_pool().await?;

        let tables_rows = sqlx::query(TABLES_QUERY)
            .fetch_all(&pool)
            .await
            .map_err(|e| e.to_string())?;

        let mut tables_map: HashMap<String, TableWithStructure> = HashMap::new();

        for row in tables_rows {
            let name: String = row.try_get("name").map_err(|e| e.to_string())?;
            let table_type: String = row.try_get("type").map_err(|e| e.to_string())?;

            tables_map.insert(
                name.clone(),
                TableWithStructure {
                    schema: "main".to_string(),
                    name,
                    table_type,
                    columns: Vec::new(),
                    foreign_keys: Vec::new(),
                    indexes: Vec::new(),
                },
            );
        }

        let columns_rows = sqlx::query(COLUMNS_QUERY)
            .fetch_all(&pool)
            .await
            .map_err(|e| e.to_string())?;

        for row in columns_rows {
            let table_name: String = row.try_get("table_name").map_err(|e| e.to_string())?;
            let column_name: String = row.try_get("column_name").map_err(|e| e.to_string())?;
            let data_type: String = row
                .try_get::<String, _>("data_type")
                .map_err(|e| e.to_string())?
                .to_uppercase();
            let not_null: i32 = row.try_get("not_null").unwrap_or(0);
            let default_value: Option<String> = row.try_get("default_value").ok();
            let primary_key: i32 = row.try_get("primary_key").unwrap_or(0);

            if let Some(table) = tables_map.get_mut(&table_name) {
                table.columns.push(ColumnInfo {
                    name: column_name,
                    data_type,
                    nullable: not_null == 0,
                    default: default_value,
                    primary_key: primary_key > 0,
                });
            }
        }

        let foreign_keys_rows = sqlx::query(FOREIGN_KEYS_QUERY)
            .fetch_all(&pool)
            .await
            .map_err(|e| e.to_string())?;

        for row in foreign_keys_rows {
            let table_name: String = row.try_get("table_name").map_err(|e| e.to_string())?;
            let column_name: String = row.try_get("column_name").map_err(|e| e.to_string())?;
            let references_table: String =
                row.try_get("references_table").map_err(|e| e.to_string())?;
            let references_column: String = row
                .try_get("references_column")
                .map_err(|e| e.to_string())?;

            if let Some(table) = tables_map.get_mut(&table_name) {
                table.foreign_keys.push(ForeignKeyInfo {
                    name: format!("fk_{}_{}", table_name, column_name),
                    column: column_name,
                    references_table,
                    references_column,
                });
            }
        }

        let indexes_rows = sqlx::query(INDEXES_QUERY)
            .fetch_all(&pool)
            .await
            .map_err(|e| e.to_string())?;

        let mut index_map: HashMap<(String, String), IndexInfo> = HashMap::new();

        for row in indexes_rows {
            let table_name: String = row.try_get("table_name").map_err(|e| e.to_string())?;
            let index_name: String = row.try_get("index_name").map_err(|e| e.to_string())?;
            let is_unique: i32 = row.try_get("is_unique").unwrap_or(0);
            let origin: String = row.try_get("origin").unwrap_or_default();

            index_map.insert(
                (table_name.clone(), index_name.clone()),
                IndexInfo {
                    name: index_name,
                    columns: Vec::new(),
                    unique: is_unique > 0,
                    primary: origin == "pk",
                },
            );
        }

        for ((table_name, index_name), index_info) in index_map {
            let index_info_query = format!(
                "SELECT name as column_name FROM pragma_index_info('{}') ORDER BY seqno",
                index_name
            );
            let index_cols = sqlx::query(&index_info_query)
                .fetch_all(&pool)
                .await
                .map_err(|e| e.to_string())?;

            let columns: Vec<String> = index_cols
                .iter()
                .filter_map(|row| row.try_get("column_name").ok())
                .collect();

            if let Some(table) = tables_map.get_mut(&table_name) {
                table.indexes.push(IndexInfo {
                    name: index_info.name,
                    columns,
                    unique: index_info.unique,
                    primary: index_info.primary,
                });
            }
        }

        pool.close().await;

        let tables: Vec<TableWithStructure> = tables_map.into_values().collect();

        Ok(SchemaOverview { tables })
    }
}
