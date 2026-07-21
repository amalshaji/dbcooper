use async_trait::async_trait;
use futures_util::{StreamExt, TryStreamExt};
use serde_json::{json, Value};
use sqlx::sqlite::SqlitePoolOptions;
use sqlx::{Column, Row, TypeInfo};
use tokio::sync::OnceCell;

use super::create_table::build_sqlite_create_table_sql;
use super::filter::{
    build_where_clause, classify_column_type, compile_filter, structured_expression,
    CompiledFilter, FilterDialect, FilterValue,
};
use super::{query_returns_rows, DatabaseDriver, SqliteConfig};
use crate::database::queries::sqlite::{
    COLUMNS_QUERY, FOREIGN_KEYS_QUERY, INDEXES_QUERY, TABLES_QUERY,
};
use crate::db::models::{
    ColumnInfo, CreateTableRequest, ForeignKeyInfo, IndexInfo, QueryResult, SchemaOverview,
    TableDataResponse, TableFilter, TableInfo, TableStructure, TableWithStructure,
    TestConnectionResult,
};
use std::collections::HashMap;

pub struct SqliteDriver {
    config: SqliteConfig,
    /// Dropping the driver drops the final pool handle and closes its connections.
    pool: OnceCell<sqlx::SqlitePool>,
}

impl SqliteDriver {
    pub fn new(config: SqliteConfig) -> Self {
        Self {
            config,
            pool: OnceCell::new(),
        }
    }

    fn connection_string(&self) -> String {
        format!("sqlite:{}?mode=rwc", self.config.file_path)
    }

    fn bind_filter<'q>(
        mut query: sqlx::query::Query<'q, sqlx::Sqlite, sqlx::sqlite::SqliteArguments<'q>>,
        filter: &'q CompiledFilter,
    ) -> sqlx::query::Query<'q, sqlx::Sqlite, sqlx::sqlite::SqliteArguments<'q>> {
        for value in &filter.values {
            query = match value {
                FilterValue::Text(value) => query.bind(value),
                FilterValue::Integer(value) => query.bind(value),
                FilterValue::Float(value) => query.bind(value),
                FilterValue::Boolean(value) => query.bind(value),
                FilterValue::ExactNumber { value, .. } => query.bind(value),
            };
        }
        query
    }

    async fn get_pool(&self) -> Result<&sqlx::SqlitePool, String> {
        self.pool
            .get_or_try_init(|| async {
                SqlitePoolOptions::new()
                    .max_connections(1)
                    .connect(&self.connection_string())
                    .await
                    .map_err(|e| e.to_string())
            })
            .await
    }

    async fn get_primary_key_columns(
        pool: &sqlx::SqlitePool,
        table: &str,
    ) -> Result<Vec<String>, String> {
        let rows = sqlx::query_as::<_, (String,)>(
            "SELECT name FROM pragma_table_info(?) WHERE pk > 0 ORDER BY pk",
        )
        .bind(table)
        .fetch_all(pool)
        .await
        .map_err(|e| e.to_string())?;

        Ok(rows.into_iter().map(|(column,)| column).collect())
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
                let result = sqlx::query("SELECT 1").fetch_one(pool).await;
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
        .fetch_all(pool)
        .await
        .map_err(|e| e.to_string())?;

        Ok(tables
            .into_iter()
            .map(|(name, table_type)| TableInfo {
                schema: "main".to_string(),
                name,
                table_type,
            })
            .collect())
    }

    fn preview_create_table(&self, request: &CreateTableRequest) -> Result<String, String> {
        build_sqlite_create_table_sql(request)
    }

    async fn create_table(&self, request: &CreateTableRequest) -> Result<TableInfo, String> {
        let sql = self.preview_create_table(request)?;
        let pool = self.get_pool().await?;
        let result = sqlx::query(&sql)
            .execute(&pool)
            .await
            .map_err(|error| error.to_string());
        pool.close().await;
        result?;

        Ok(TableInfo {
            schema: request.schema.clone(),
            name: request.name.clone(),
            table_type: "table".to_string(),
        })
    }

    async fn get_table_data(
        &self,
        _schema: &str, // SQLite doesn't use schemas
        table: &str,
        page: i64,
        limit: i64,
        filter: Option<TableFilter>,
        sort_column: Option<String>,
        sort_direction: Option<String>,
    ) -> Result<TableDataResponse, String> {
        let pool = self.get_pool().await?;

        let offset = (page - 1) * limit;
        let compiled_filter = if let Some(expression) = structured_expression(filter.as_ref()) {
            let columns = self.get_table_structure("main", table).await?.columns;
            Some(compile_filter(expression, &columns, FilterDialect::Sqlite)?)
        } else {
            None
        };
        let where_clause = build_where_clause(filter.as_ref(), compiled_filter.as_ref());

        let order_clause = if let Some(col) = sort_column.as_ref() {
            // Validate sort_direction to prevent SQL injection
            let dir = match sort_direction
                .as_deref()
                .map(|s| s.to_lowercase())
                .as_deref()
            {
                Some("asc") => "ASC",
                Some("desc") => "DESC",
                _ => "ASC", // Default to ASC for invalid/missing values
            };
            // Escape double quotes in column name to prevent SQL injection
            let escaped_col = col.replace('"', "\"\"");
            format!(" ORDER BY \"{}\" {}", escaped_col, dir)
        } else {
            let primary_key_columns = Self::get_primary_key_columns(pool, table).await?;
            if primary_key_columns.is_empty() {
                String::new()
            } else {
                let order_columns = primary_key_columns
                    .iter()
                    .map(|col| format!("\"{}\" ASC", col.replace('"', "\"\"")))
                    .collect::<Vec<_>>()
                    .join(", ");
                format!(" ORDER BY {}", order_columns)
            }
        };

        let count_query = format!(
            "SELECT COUNT(*) as count FROM \"{}\"{}",
            table, where_clause
        );
        let count_row = if let Some(filter) = compiled_filter.as_ref() {
            Self::bind_filter(sqlx::query(&count_query), filter)
                .fetch_one(pool)
                .await
                .map(|row| (row.get::<i64, _>(0),))
        } else {
            sqlx::query_as(&count_query).fetch_one(pool).await
        }
        .map_err(|e| e.to_string())?;
        let total = count_row.0;

        let data_query = format!(
            "SELECT * FROM \"{}\"{}{} LIMIT {} OFFSET {}",
            table, where_clause, order_clause, limit, offset
        );

        let rows = if let Some(filter) = compiled_filter.as_ref() {
            Self::bind_filter(sqlx::query(&data_query), filter)
                .fetch_all(pool)
                .await
        } else {
            sqlx::query(&data_query).fetch_all(pool).await
        }
        .map_err(|e| e.to_string())?;

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
            .fetch_all(pool)
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
                    filter_kind: classify_column_type(&data_type, FilterDialect::Sqlite),
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
            .fetch_all(pool)
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
                .fetch_all(pool)
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
            .fetch_all(pool)
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

        Ok(TableStructure {
            columns,
            indexes,
            foreign_keys,
        })
    }

    async fn execute_query(&self, query: &str) -> Result<QueryResult, String> {
        let start_time = std::time::Instant::now();
        let pool = self.get_pool().await?;

        if query_returns_rows(query) {
            match sqlx::query(query)
                .fetch(pool)
                .take(crate::database::MAX_QUERY_RESULT_ROWS + 1)
                .try_collect::<Vec<_>>()
                .await
            {
                Ok(rows) => {
                    let truncated = rows.len() > crate::database::MAX_QUERY_RESULT_ROWS;
                    let data: Vec<Value> = rows
                        .iter()
                        .take(crate::database::MAX_QUERY_RESULT_ROWS)
                        .map(Self::row_to_json)
                        .collect();
                    let row_count = data.len() as i64;
                    Ok(QueryResult {
                        data,
                        row_count,
                        truncated,
                        rows_affected: None,
                        error: None,
                        time_taken_ms: Some(start_time.elapsed().as_millis()),
                    })
                }
                Err(e) => Ok(QueryResult {
                    data: vec![],
                    row_count: 0,
                    truncated: false,
                    rows_affected: None,
                    error: Some(e.to_string()),
                    time_taken_ms: Some(start_time.elapsed().as_millis()),
                }),
            }
        } else {
            match sqlx::query(query).execute(pool).await {
                Ok(result) => {
                    let rows_affected = result.rows_affected();
                    Ok(QueryResult {
                        data: vec![],
                        row_count: rows_affected as i64,
                        truncated: false,
                        rows_affected: Some(rows_affected),
                        error: None,
                        time_taken_ms: Some(start_time.elapsed().as_millis()),
                    })
                }
                Err(e) => Ok(QueryResult {
                    data: vec![],
                    row_count: 0,
                    truncated: false,
                    rows_affected: None,
                    error: Some(e.to_string()),
                    time_taken_ms: Some(start_time.elapsed().as_millis()),
                }),
            }
        }
    }

    async fn get_schema_overview(&self) -> Result<SchemaOverview, String> {
        let pool = self.get_pool().await?;

        let tables_rows = sqlx::query(TABLES_QUERY)
            .fetch_all(pool)
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
            .fetch_all(pool)
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
                    filter_kind: classify_column_type(&data_type, FilterDialect::Sqlite),
                    data_type,
                    nullable: not_null == 0,
                    default: default_value,
                    primary_key: primary_key > 0,
                });
            }
        }

        let foreign_keys_rows = sqlx::query(FOREIGN_KEYS_QUERY)
            .fetch_all(pool)
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
            .fetch_all(pool)
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
                .fetch_all(pool)
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

        let tables: Vec<TableWithStructure> = tables_map.into_values().collect();

        Ok(SchemaOverview {
            tables,
            functions: Vec::new(),
        })
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[tokio::test]
    async fn initializes_one_pool_and_reuses_it_across_operations() {
        let directory = tempfile::tempdir().unwrap();
        let driver = SqliteDriver::new(SqliteConfig {
            file_path: directory.path().join("reuse.sqlite").display().to_string(),
        });

        let (first, second) = tokio::join!(driver.get_pool(), driver.get_pool());
        let first = first.unwrap();
        let second = second.unwrap();

        assert!(std::ptr::eq(first, second));
        assert_eq!(first.options().get_max_connections(), 1);

        driver
            .execute_query("CREATE TABLE reused_pool (id INTEGER PRIMARY KEY)")
            .await
            .unwrap();
        let tables = driver.list_tables().await.unwrap();

        assert!(tables.iter().any(|table| table.name == "reused_pool"));
        assert!(std::ptr::eq(first, driver.get_pool().await.unwrap()));
    }
}
