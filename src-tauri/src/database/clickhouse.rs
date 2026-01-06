use async_trait::async_trait;
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};

use super::DatabaseDriver;
use crate::database::queries::clickhouse::{COLUMNS_QUERY, INDEXES_QUERY};
use crate::db::models::{
    ColumnInfo, ForeignKeyInfo, IndexInfo, QueryResult, SchemaOverview, TableDataResponse,
    TableInfo, TableStructure, TableWithStructure, TestConnectionResult,
};
use std::collections::HashMap;

/// ClickHouse protocol type
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
pub enum ClickhouseProtocol {
    Http,
    Tcp,
}

impl Default for ClickhouseProtocol {
    fn default() -> Self {
        ClickhouseProtocol::Http
    }
}

/// Configuration for ClickHouse connections
#[derive(Clone)]
pub struct ClickhouseConfig {
    pub host: String,
    pub port: i64,
    pub database: String,
    pub username: String,
    pub password: String,
    #[allow(dead_code)] // Reserved for future TCP protocol support
    pub protocol: ClickhouseProtocol,
    pub ssl: bool,
}

pub struct ClickhouseDriver {
    config: ClickhouseConfig,
}

impl ClickhouseDriver {
    pub fn new(config: ClickhouseConfig) -> Self {
        Self { config }
    }

    fn build_url(&self) -> String {
        let scheme = if self.config.ssl { "https" } else { "http" };
        format!("{}://{}:{}", scheme, self.config.host, self.config.port)
    }

    /// Execute a query and return JSON results using raw HTTP
    async fn execute_query_json(&self, query: &str) -> Result<Vec<Value>, String> {
        let url = self.build_url();
        let client = reqwest::Client::new();

        // Clean up the query: trim whitespace, remove trailing semicolons
        let cleaned_query = query.trim().trim_end_matches(';').trim();

        // Only add FORMAT if not already present
        let full_query = if cleaned_query.to_uppercase().contains("FORMAT ") {
            cleaned_query.to_string()
        } else {
            format!("{} FORMAT JSONEachRow", cleaned_query)
        };

        let response = client
            .post(&url)
            .basic_auth(&self.config.username, Some(&self.config.password))
            .query(&[("database", &self.config.database)])
            .body(full_query)
            .send()
            .await
            .map_err(|e| e.to_string())?;

        if !response.status().is_success() {
            let error_text = response.text().await.unwrap_or_default();
            return Err(error_text);
        }

        let text = response.text().await.map_err(|e| e.to_string())?;

        // Parse JSONEachRow format (one JSON object per line)
        let rows: Vec<Value> = text
            .lines()
            .filter(|line| !line.is_empty())
            .filter_map(|line| serde_json::from_str(line).ok())
            .collect();

        Ok(rows)
    }

    /// Execute a non-SELECT query
    async fn execute_command(&self, query: &str) -> Result<(), String> {
        let url = self.build_url();
        let client = reqwest::Client::new();

        let response = client
            .post(&url)
            .basic_auth(&self.config.username, Some(&self.config.password))
            .query(&[("database", &self.config.database)])
            .body(query.to_string())
            .send()
            .await
            .map_err(|e| e.to_string())?;

        if !response.status().is_success() {
            let error_text = response.text().await.unwrap_or_default();
            return Err(error_text);
        }

        Ok(())
    }

    /// Normalize filter to handle smart quotes from macOS
    fn normalize_filter(filter: &str) -> String {
        filter
            .replace('\u{2018}', "'") // Left single quotation mark
            .replace('\u{2019}', "'") // Right single quotation mark
            .replace('\u{201C}', "\"") // Left double quotation mark
            .replace('\u{201D}', "\"") // Right double quotation mark
            .replace("\\'", "'") // Backslash-escaped single quote
    }
}

#[async_trait]
impl DatabaseDriver for ClickhouseDriver {
    async fn test_connection(&self) -> Result<TestConnectionResult, String> {
        match self.execute_query_json("SELECT 1").await {
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

    async fn list_tables(&self) -> Result<Vec<TableInfo>, String> {
        let query = format!(
            "SELECT database, name, engine FROM system.tables WHERE database = '{}'  ORDER BY name",
            self.config.database
        );

        let rows = self.execute_query_json(&query).await?;

        Ok(rows
            .into_iter()
            .map(|row| TableInfo {
                schema: row["database"].as_str().unwrap_or("").to_string(),
                name: row["name"].as_str().unwrap_or("").to_string(),
                table_type: row["engine"].as_str().unwrap_or("table").to_string(),
            })
            .collect())
    }

    async fn get_table_data(
        &self,
        _schema: &str,
        table: &str,
        page: i64,
        limit: i64,
        filter: Option<String>,
        sort_column: Option<String>,
        sort_direction: Option<String>,
    ) -> Result<TableDataResponse, String> {
        let offset = (page - 1) * limit;
        let where_clause = filter
            .as_ref()
            .map(|f| {
                let normalized = Self::normalize_filter(f);
                format!(" WHERE {}", normalized)
            })
            .unwrap_or_default();

        let order_clause = sort_column
            .as_ref()
            .map(|col| {
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
                // Escape backticks in column name to prevent SQL injection
                let escaped_col = col.replace('`', "``");
                format!(" ORDER BY `{}` {}", escaped_col, dir)
            })
            .unwrap_or_default();

        // Get total count
        let count_query = format!("SELECT count() as count FROM `{}`{}", table, where_clause);
        let count_rows = self.execute_query_json(&count_query).await?;
        let total = count_rows
            .first()
            .and_then(|r| r["count"].as_str())
            .and_then(|s| s.parse::<i64>().ok())
            .or_else(|| count_rows.first().and_then(|r| r["count"].as_i64()))
            .unwrap_or(0);

        // Get data
        let data_query = format!(
            "SELECT * FROM `{}`{}{} LIMIT {} OFFSET {}",
            table, where_clause, order_clause, limit, offset
        );
        let data = self.execute_query_json(&data_query).await?;

        Ok(TableDataResponse {
            data,
            total,
            page,
            limit,
        })
    }

    async fn get_table_structure(
        &self,
        _schema: &str,
        table: &str,
    ) -> Result<TableStructure, String> {
        // Get columns
        let columns_query = format!(
            "SELECT name, type, default_kind, default_expression, is_in_primary_key 
             FROM system.columns 
             WHERE database = '{}' AND table = '{}'
             ORDER BY position",
            self.config.database, table
        );

        let columns = self.execute_query_json(&columns_query).await?;

        let column_infos: Vec<ColumnInfo> = columns
            .into_iter()
            .map(|col| {
                let data_type = col["type"].as_str().unwrap_or("").to_string();
                let nullable = data_type.starts_with("Nullable");
                ColumnInfo {
                    name: col["name"].as_str().unwrap_or("").to_string(),
                    data_type,
                    nullable,
                    default: {
                        let expr = col["default_expression"].as_str().unwrap_or("");
                        if expr.is_empty() {
                            None
                        } else {
                            let kind = col["default_kind"].as_str().unwrap_or("");
                            Some(format!("{} {}", kind, expr))
                        }
                    },
                    primary_key: col["is_in_primary_key"].as_u64().unwrap_or(0) == 1,
                }
            })
            .collect();

        // Get indexes (data skipping indexes)
        let indexes_query = format!(
            "SELECT name, expr, type FROM system.data_skipping_indices 
             WHERE database = '{}' AND table = '{}'",
            self.config.database, table
        );

        let indexes = self
            .execute_query_json(&indexes_query)
            .await
            .unwrap_or_default();

        let index_infos: Vec<IndexInfo> = indexes
            .into_iter()
            .map(|idx| IndexInfo {
                name: idx["name"].as_str().unwrap_or("").to_string(),
                columns: vec![idx["expr"].as_str().unwrap_or("").to_string()],
                unique: false,
                primary: false,
            })
            .collect();

        // ClickHouse doesn't have foreign keys
        let foreign_keys: Vec<ForeignKeyInfo> = vec![];

        Ok(TableStructure {
            columns: column_infos,
            indexes: index_infos,
            foreign_keys,
        })
    }

    async fn get_schema_overview(&self) -> Result<SchemaOverview, String> {
        let columns_query =
            COLUMNS_QUERY.replace("currentDatabase()", &format!("'{}'", self.config.database));
        let columns_rows = self.execute_query_json(&columns_query).await?;

        let indexes_query =
            INDEXES_QUERY.replace("currentDatabase()", &format!("'{}'", self.config.database));
        let indexes_rows = self
            .execute_query_json(&indexes_query)
            .await
            .unwrap_or_default();

        let mut indexes_map: HashMap<(String, String), Vec<IndexInfo>> = HashMap::new();

        for idx_row in indexes_rows {
            let database: String = idx_row["database"].as_str().unwrap_or("").to_string();
            let table: String = idx_row["table"].as_str().unwrap_or("").to_string();
            let empty_vec = vec![];
            let indexes_raw = idx_row["indexes_raw"].as_array().unwrap_or(&empty_vec);

            let mut indexes = Vec::new();
            for idx_tuple in indexes_raw {
                if let Some(arr) = idx_tuple.as_array() {
                    if arr.len() >= 3 {
                        let name = arr[0].as_str().unwrap_or("").to_string();
                        let expr = arr[1].as_str().unwrap_or("").to_string();
                        let _type = arr[2].as_str().unwrap_or("").to_string();

                        indexes.push(IndexInfo {
                            name,
                            columns: vec![expr],
                            unique: false,
                            primary: false,
                        });
                    }
                }
            }

            indexes_map.insert((database, table), indexes);
        }

        let mut tables = Vec::new();

        for col_row in columns_rows {
            let schema: String = col_row["schema"].as_str().unwrap_or("").to_string();
            let name: String = col_row["name"].as_str().unwrap_or("").to_string();
            let table_type: String = col_row["type"].as_str().unwrap_or("table").to_string();

            let empty_vec = vec![];
            let columns_raw = col_row["columns_raw"].as_array().unwrap_or(&empty_vec);

            let mut columns = Vec::new();
            for col_tuple in columns_raw {
                if let Some(arr) = col_tuple.as_array() {
                    if arr.len() >= 5 {
                        let col_name = arr[0].as_str().unwrap_or("").to_string();
                        let col_type = arr[1].as_str().unwrap_or("").to_string();
                        let default_kind = arr[2].as_str().unwrap_or("");
                        let default_expr = arr[3].as_str().unwrap_or("");
                        let is_pk = arr[4].as_u64().unwrap_or(0) == 1;

                        let nullable = col_type.starts_with("Nullable");
                        let default = if default_expr.is_empty() {
                            None
                        } else {
                            Some(format!("{} {}", default_kind, default_expr))
                        };

                        columns.push(ColumnInfo {
                            name: col_name,
                            data_type: col_type,
                            nullable,
                            default,
                            primary_key: is_pk,
                        });
                    }
                }
            }

            let indexes = indexes_map
                .remove(&(schema.clone(), name.clone()))
                .unwrap_or_default();

            tables.push(TableWithStructure {
                schema,
                name,
                table_type,
                columns,
                foreign_keys: Vec::new(),
                indexes,
            });
        }

        Ok(SchemaOverview { tables })
    }

    async fn execute_query(&self, query: &str) -> Result<QueryResult, String> {
        let start_time = std::time::Instant::now();
        // Check if it's a SELECT query
        let trimmed = query.trim().to_uppercase();
        let is_select = trimmed.starts_with("SELECT")
            || trimmed.starts_with("SHOW")
            || trimmed.starts_with("DESCRIBE")
            || trimmed.starts_with("WITH");

        if is_select {
            match self.execute_query_json(query).await {
                Ok(rows) => {
                    let row_count = rows.len() as i64;
                    Ok(QueryResult {
                        data: rows,
                        row_count,
                        error: None,
                        time_taken_ms: Some(start_time.elapsed().as_millis()),
                    })
                }
                Err(e) => Ok(QueryResult {
                    data: vec![],
                    row_count: 0,
                    error: Some(e),
                    time_taken_ms: Some(start_time.elapsed().as_millis()),
                }),
            }
        } else {
            // For non-SELECT queries (INSERT, ALTER, CREATE, etc.)
            match self.execute_command(query).await {
                Ok(_) => Ok(QueryResult {
                    data: vec![json!({"result": "Query executed successfully"})],
                    row_count: 0,
                    error: None,
                    time_taken_ms: Some(start_time.elapsed().as_millis()),
                }),
                Err(e) => Ok(QueryResult {
                    data: vec![],
                    row_count: 0,
                    error: Some(e),
                    time_taken_ms: Some(start_time.elapsed().as_millis()),
                }),
            }
        }
    }
}
