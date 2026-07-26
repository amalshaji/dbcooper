use async_trait::async_trait;
use futures_util::{StreamExt, TryStreamExt};
use serde_json::{json, Value};
use sqlx::mysql::{MySqlConnectOptions, MySqlPoolOptions, MySqlSslMode};
use sqlx::{Column, Row, TypeInfo};
use std::collections::BTreeMap;
use std::sync::Arc;
use tokio::sync::RwLock;

use super::create_table::{build_mariadb_create_table_sql, build_mysql_create_table_sql};
use super::filter::{
    build_where_clause, classify_column_type, compile_filter, structured_expression,
    CompiledFilter, FilterDialect, FilterValue,
};
use super::mutation::MutationPlan;
use super::{
    mysql_read_only_query_is_safe, mysql_read_only_uses_text_protocol, query_returns_rows,
    DatabaseDriver, MysqlConfig, MysqlFlavor,
};
use crate::db::models::{
    ColumnInfo, CreateTableRequest, ForeignKeyInfo, IndexInfo, QueryResult, SchemaOverview,
    TableDataResponse, TableFilter, TableInfo, TableStructure, TableWithStructure,
    TestConnectionResult,
};

pub struct MysqlDriver {
    config: MysqlConfig,
    pool: Arc<RwLock<Option<sqlx::MySqlPool>>>,
}

impl MysqlDriver {
    pub fn new(config: MysqlConfig) -> Self {
        Self {
            config,
            pool: Arc::new(RwLock::new(None)),
        }
    }

    fn label(&self) -> &'static str {
        if self.config.flavor == MysqlFlavor::Mariadb {
            "MariaDB"
        } else {
            "MySQL"
        }
    }

    fn connect_options(&self) -> Result<MySqlConnectOptions, String> {
        let port =
            u16::try_from(self.config.port).map_err(|_| "Port must be between 1 and 65535")?;
        Ok(MySqlConnectOptions::new()
            .host(&self.config.host)
            .port(port)
            .username(&self.config.username)
            .password(&self.config.password)
            .database(&self.config.database)
            .ssl_mode(if self.config.ssl {
                MySqlSslMode::Required
            } else {
                MySqlSslMode::Disabled
            }))
    }

    async fn create_pool(&self) -> Result<sqlx::MySqlPool, String> {
        let options = self.connect_options()?;
        match tokio::time::timeout(
            std::time::Duration::from_secs(15),
            MySqlPoolOptions::new()
                .max_connections(5)
                .acquire_timeout(std::time::Duration::from_secs(30))
                .idle_timeout(std::time::Duration::from_secs(600))
                .test_before_acquire(false)
                .connect_with(options),
        )
        .await
        {
            Ok(Ok(pool)) => Ok(pool),
            Ok(Err(error)) => Err(format!("Failed to connect to {}: {error}", self.label())),
            Err(_) => Err("Connection timed out after 15 seconds".to_string()),
        }
    }

    async fn get_pool(&self) -> Result<sqlx::MySqlPool, String> {
        if let Some(pool) = self.pool.read().await.as_ref() {
            return Ok(pool.clone());
        }
        let mut guard = self.pool.write().await;
        if let Some(pool) = guard.as_ref() {
            return Ok(pool.clone());
        }
        let pool = self.create_pool().await?;
        *guard = Some(pool.clone());
        Ok(pool)
    }

    fn bind_filter<'q>(
        mut query: sqlx::query::Query<'q, sqlx::MySql, sqlx::mysql::MySqlArguments>,
        filter: &'q CompiledFilter,
    ) -> sqlx::query::Query<'q, sqlx::MySql, sqlx::mysql::MySqlArguments> {
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

    fn bind_values<'q>(
        mut query: sqlx::query::Query<'q, sqlx::MySql, sqlx::mysql::MySqlArguments>,
        values: &'q [Value],
    ) -> Result<sqlx::query::Query<'q, sqlx::MySql, sqlx::mysql::MySqlArguments>, String> {
        for value in values {
            query = match value {
                Value::Null => query.bind(Option::<String>::None),
                Value::Bool(value) => query.bind(*value),
                Value::Number(value) if value.is_i64() => query.bind(value.as_i64().unwrap()),
                Value::Number(value) if value.is_u64() => query.bind(value.as_u64().unwrap()),
                Value::Number(value) => query.bind(value.as_f64().ok_or("Invalid numeric value")?),
                Value::String(value) => query.bind(value),
                Value::Array(_) | Value::Object(_) => query.bind(value.to_string()),
            };
        }
        Ok(query)
    }

    fn quote(identifier: &str) -> String {
        format!("`{}`", identifier.replace('`', "``"))
    }

    fn table_ref(&self, schema: &str, table: &str) -> Result<String, String> {
        if schema != self.config.database {
            return Err(
                "MySQL and MariaDB connections are limited to the selected database".to_string(),
            );
        }
        Ok(format!("{}.{}", Self::quote(schema), Self::quote(table)))
    }

    fn row_to_json(row: &sqlx::mysql::MySqlRow) -> Value {
        let mut object = serde_json::Map::new();
        for (index, column) in row.columns().iter().enumerate() {
            let type_name = column.type_info().name();
            let value = match type_name {
                "BOOLEAN" => row.try_get::<bool, _>(index).map(|value| json!(value)),
                "TINYINT" => row.try_get::<i8, _>(index).map(|value| json!(value)),
                "TINYINT UNSIGNED" => row.try_get::<u8, _>(index).map(|value| json!(value)),
                "SMALLINT" => row.try_get::<i16, _>(index).map(|value| json!(value)),
                "SMALLINT UNSIGNED" => row.try_get::<u16, _>(index).map(|value| json!(value)),
                "INT" | "MEDIUMINT" => row.try_get::<i32, _>(index).map(|value| json!(value)),
                "INT UNSIGNED" | "MEDIUMINT UNSIGNED" => {
                    row.try_get::<u32, _>(index).map(|value| json!(value))
                }
                "BIGINT" => row
                    .try_get::<i64, _>(index)
                    .map(|value| json!(value.to_string())),
                "BIGINT UNSIGNED" => row
                    .try_get::<u64, _>(index)
                    .map(|value| json!(value.to_string())),
                "FLOAT" => row.try_get::<f32, _>(index).map(|value| json!(value)),
                "DOUBLE" => row.try_get::<f64, _>(index).map(|value| json!(value)),
                "YEAR" => row.try_get::<u16, _>(index).map(|value| json!(value)),
                "BIT" => row
                    .try_get::<u64, _>(index)
                    .map(|value| json!(value.to_string())),
                "DECIMAL" => row
                    .try_get_unchecked::<String, _>(index)
                    .map(|value| json!(value)),
                "DATE" => row
                    .try_get::<chrono::NaiveDate, _>(index)
                    .map(|value| json!(value.to_string())),
                "DATETIME" | "TIMESTAMP" => row
                    .try_get::<chrono::NaiveDateTime, _>(index)
                    .map(|value| json!(value.to_string())),
                "TIME" => row
                    .try_get::<sqlx::mysql::types::MySqlTime, _>(index)
                    .map(|value| json!(value.to_string())),
                "JSON" => row.try_get::<Value, _>(index),
                "BINARY" | "VARBINARY" | "TINYBLOB" | "BLOB" | "MEDIUMBLOB" | "LONGBLOB"
                | "GEOMETRY" => row
                    .try_get::<Vec<u8>, _>(index)
                    .map(|value| json!(format!("0x{}", hex::encode(value)))),
                "ENUM" | "SET" => row
                    .try_get_unchecked::<String, _>(index)
                    .map(|value| json!(value)),
                _ => row.try_get::<String, _>(index).map(|value| json!(value)),
            }
            .unwrap_or(Value::Null);
            object.insert(column.name().to_string(), value);
        }
        Value::Object(object)
    }

    async fn primary_key_columns(&self, table: &str) -> Result<Vec<String>, String> {
        let pool = self.get_pool().await?;
        sqlx::query_scalar(
            "SELECT CAST(column_name AS CHAR) FROM information_schema.key_column_usage WHERE table_schema = ? AND table_name = ? AND constraint_name = 'PRIMARY' ORDER BY ordinal_position",
        )
        .bind(&self.config.database)
        .bind(table)
        .fetch_all(&pool)
        .await
        .map_err(|error| error.to_string())
    }
}

#[async_trait]
impl DatabaseDriver for MysqlDriver {
    async fn test_connection(&self) -> Result<TestConnectionResult, String> {
        match self.get_pool().await {
            Ok(pool) => match sqlx::query("SELECT 1").fetch_one(&pool).await {
                Ok(_) => Ok(TestConnectionResult {
                    success: true,
                    message: "Connection successful!".to_string(),
                }),
                Err(error) => Ok(TestConnectionResult {
                    success: false,
                    message: format!("Connection failed: {error}"),
                }),
            },
            Err(error) => Ok(TestConnectionResult {
                success: false,
                message: format!("Connection failed: {error}"),
            }),
        }
    }

    async fn list_tables(&self) -> Result<Vec<TableInfo>, String> {
        let pool = self.get_pool().await?;
        let rows = sqlx::query_as::<_, (String, String)>(
            "SELECT CAST(table_name AS CHAR), CAST(table_type AS CHAR) FROM information_schema.tables WHERE table_schema = ? ORDER BY table_name",
        )
        .bind(&self.config.database)
        .fetch_all(&pool)
        .await
        .map_err(|error| error.to_string())?;
        Ok(rows
            .into_iter()
            .map(|(name, table_type)| TableInfo {
                schema: self.config.database.clone(),
                name,
                table_type: if table_type == "VIEW" {
                    "view"
                } else {
                    "table"
                }
                .to_string(),
            })
            .collect())
    }

    fn preview_create_table(&self, request: &CreateTableRequest) -> Result<String, String> {
        if request.schema != self.config.database {
            return Err("Tables can only be created in the selected database".to_string());
        }
        if self.config.flavor == MysqlFlavor::Mariadb {
            build_mariadb_create_table_sql(request)
        } else {
            build_mysql_create_table_sql(request)
        }
    }

    async fn create_table(&self, request: &CreateTableRequest) -> Result<TableInfo, String> {
        let sql = self.preview_create_table(request)?;
        sqlx::query(&sql)
            .execute(&self.get_pool().await?)
            .await
            .map_err(|error| error.to_string())?;
        Ok(TableInfo {
            schema: request.schema.clone(),
            name: request.name.clone(),
            table_type: "table".to_string(),
        })
    }

    async fn get_table_data(
        &self,
        schema: &str,
        table: &str,
        page: i64,
        limit: i64,
        filter: Option<TableFilter>,
        sort_column: Option<String>,
        sort_direction: Option<String>,
    ) -> Result<TableDataResponse, String> {
        let pool = self.get_pool().await?;
        let table_ref = self.table_ref(schema, table)?;
        let compiled = if let Some(expression) = structured_expression(filter.as_ref()) {
            Some(compile_filter(
                expression,
                &self.get_table_structure(schema, table).await?.columns,
                FilterDialect::Mysql,
            )?)
        } else {
            None
        };
        let where_clause = build_where_clause(filter.as_ref(), compiled.as_ref());
        let order_columns = if let Some(column) = sort_column {
            let direction = if sort_direction
                .as_deref()
                .is_some_and(|value| value.eq_ignore_ascii_case("desc"))
            {
                "DESC"
            } else {
                "ASC"
            };
            vec![format!("{} {direction}", Self::quote(&column))]
        } else {
            self.primary_key_columns(table)
                .await?
                .into_iter()
                .map(|column| format!("{} ASC", Self::quote(&column)))
                .collect()
        };
        let order_clause = if order_columns.is_empty() {
            String::new()
        } else {
            format!(" ORDER BY {}", order_columns.join(", "))
        };
        let count_sql = format!("SELECT COUNT(*) FROM {table_ref}{where_clause}");
        let count_row = if let Some(compiled) = compiled.as_ref() {
            Self::bind_filter(sqlx::query(&count_sql), compiled)
                .fetch_one(&pool)
                .await
        } else {
            sqlx::query(&count_sql).fetch_one(&pool).await
        }
        .map_err(|error| error.to_string())?;
        let total = count_row
            .try_get::<i64, _>(0)
            .map_err(|error| error.to_string())?;
        let offset = (page - 1).max(0) * limit;
        let data_sql =
            format!("SELECT * FROM {table_ref}{where_clause}{order_clause} LIMIT ? OFFSET ?");
        let rows = if let Some(compiled) = compiled.as_ref() {
            Self::bind_filter(sqlx::query(&data_sql), compiled)
                .bind(limit)
                .bind(offset)
                .fetch_all(&pool)
                .await
        } else {
            sqlx::query(&data_sql)
                .bind(limit)
                .bind(offset)
                .fetch_all(&pool)
                .await
        }
        .map_err(|error| error.to_string())?;
        Ok(TableDataResponse {
            data: rows.iter().map(Self::row_to_json).collect(),
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
        self.table_ref(schema, table)?;
        let pool = self.get_pool().await?;
        let column_rows = sqlx::query_as::<_, (String, String, String, Option<String>, String)>(
            "SELECT CAST(column_name AS CHAR), CAST(column_type AS CHAR), CAST(is_nullable AS CHAR), CAST(column_default AS CHAR), CAST(column_key AS CHAR) FROM information_schema.columns WHERE table_schema = ? AND table_name = ? ORDER BY ordinal_position",
        ).bind(schema).bind(table).fetch_all(&pool).await.map_err(|error| error.to_string())?;
        let columns = column_rows
            .into_iter()
            .map(|(name, data_type, nullable, default, key)| ColumnInfo {
                name,
                filter_kind: classify_column_type(
                    data_type.split(['(', ' ']).next().unwrap_or(&data_type),
                    FilterDialect::Mysql,
                ),
                data_type,
                nullable: nullable == "YES",
                default,
                primary_key: key == "PRI",
            })
            .collect();

        let index_rows = sqlx::query_as::<_, (String, String, i64)>(
            "SELECT CAST(index_name AS CHAR), CAST(column_name AS CHAR), CAST(non_unique AS SIGNED) FROM information_schema.statistics WHERE table_schema = ? AND table_name = ? ORDER BY index_name, seq_in_index",
        ).bind(schema).bind(table).fetch_all(&pool).await.map_err(|error| error.to_string())?;
        let mut index_map: BTreeMap<String, (Vec<String>, bool)> = BTreeMap::new();
        for (name, column, non_unique) in index_rows {
            let entry = index_map
                .entry(name)
                .or_insert_with(|| (Vec::new(), non_unique == 0));
            entry.0.push(column);
        }
        let indexes = index_map
            .into_iter()
            .map(|(name, (columns, unique))| IndexInfo {
                primary: name == "PRIMARY",
                name,
                columns,
                unique,
            })
            .collect();

        let foreign_keys = sqlx::query_as::<_, (String, String, String, String)>(
            "SELECT CAST(constraint_name AS CHAR), CAST(column_name AS CHAR), CAST(referenced_table_name AS CHAR), CAST(referenced_column_name AS CHAR) FROM information_schema.key_column_usage WHERE table_schema = ? AND table_name = ? AND referenced_table_name IS NOT NULL ORDER BY constraint_name, ordinal_position",
        ).bind(schema).bind(table).fetch_all(&pool).await.map_err(|error| error.to_string())?
            .into_iter().map(|(name, column, references_table, references_column)| ForeignKeyInfo { name, column, references_table, references_column }).collect();
        Ok(TableStructure {
            columns,
            indexes,
            foreign_keys,
        })
    }

    async fn execute_query(&self, query: &str) -> Result<QueryResult, String> {
        let start = std::time::Instant::now();
        let pool = self.get_pool().await?;
        if query_returns_rows(query) {
            match sqlx::raw_sql(query)
                .fetch(&pool)
                .take(super::MAX_QUERY_RESULT_ROWS + 1)
                .try_collect::<Vec<_>>()
                .await
            {
                Ok(rows) => {
                    let truncated = rows.len() > super::MAX_QUERY_RESULT_ROWS;
                    Ok(QueryResult::from_rows(
                        rows.iter()
                            .take(super::MAX_QUERY_RESULT_ROWS)
                            .map(Self::row_to_json)
                            .collect(),
                        truncated,
                        start,
                    ))
                }
                Err(error) => Ok(QueryResult::from_error(error.to_string(), start)),
            }
        } else {
            match sqlx::raw_sql(query).execute(&pool).await {
                Ok(result) => Ok(QueryResult {
                    data: vec![],
                    row_count: result.rows_affected() as i64,
                    truncated: false,
                    rows_affected: Some(result.rows_affected()),
                    error: None,
                    time_taken_ms: Some(start.elapsed().as_millis()),
                }),
                Err(error) => Ok(QueryResult::from_error(error.to_string(), start)),
            }
        }
    }

    async fn execute_mutation(&self, mutation: &MutationPlan) -> Result<QueryResult, String> {
        let start = std::time::Instant::now();
        let pool = self.get_pool().await?;
        match Self::bind_values(sqlx::query(&mutation.sql), &mutation.values)?
            .execute(&pool)
            .await
        {
            Ok(result) => Ok(QueryResult {
                data: vec![],
                row_count: result.rows_affected() as i64,
                truncated: false,
                rows_affected: Some(result.rows_affected()),
                error: None,
                time_taken_ms: Some(start.elapsed().as_millis()),
            }),
            Err(error) => Ok(QueryResult::from_error(error.to_string(), start)),
        }
    }

    async fn execute_query_read_only(&self, query: &str) -> Result<QueryResult, String> {
        let start = std::time::Instant::now();
        if !mysql_read_only_query_is_safe(query) {
            return Ok(QueryResult::from_error(
                "Read-only mode only allows a single read statement".to_string(),
                start,
            ));
        }
        let pool = self.get_pool().await?;
        if mysql_read_only_uses_text_protocol(query) {
            return match sqlx::raw_sql(query)
                .fetch(&pool)
                .take(super::MAX_QUERY_RESULT_ROWS + 1)
                .try_collect::<Vec<_>>()
                .await
            {
                Ok(rows) => {
                    let truncated = rows.len() > super::MAX_QUERY_RESULT_ROWS;
                    Ok(QueryResult::from_rows(
                        rows.iter()
                            .take(super::MAX_QUERY_RESULT_ROWS)
                            .map(Self::row_to_json)
                            .collect(),
                        truncated,
                        start,
                    ))
                }
                Err(error) => Ok(QueryResult::from_error(error.to_string(), start)),
            };
        }
        let mut transaction = match pool.begin_with("START TRANSACTION READ ONLY").await {
            Ok(transaction) => transaction,
            Err(error) => return Ok(QueryResult::from_error(error.to_string(), start)),
        };
        let result = sqlx::query(query)
            .fetch(&mut *transaction)
            .take(super::MAX_QUERY_RESULT_ROWS + 1)
            .try_collect::<Vec<_>>()
            .await;
        let _ = transaction.rollback().await;
        match result {
            Ok(rows) => {
                let truncated = rows.len() > super::MAX_QUERY_RESULT_ROWS;
                Ok(QueryResult::from_rows(
                    rows.iter()
                        .take(super::MAX_QUERY_RESULT_ROWS)
                        .map(Self::row_to_json)
                        .collect(),
                    truncated,
                    start,
                ))
            }
            Err(error) => Ok(QueryResult::from_error(error.to_string(), start)),
        }
    }

    async fn get_schema_overview(&self) -> Result<SchemaOverview, String> {
        let mut tables = Vec::new();
        for table in self.list_tables().await? {
            let structure = self.get_table_structure(&table.schema, &table.name).await?;
            tables.push(TableWithStructure {
                schema: table.schema,
                name: table.name,
                table_type: table.table_type,
                columns: structure.columns,
                foreign_keys: structure.foreign_keys,
                indexes: structure.indexes,
            });
        }
        Ok(SchemaOverview {
            tables,
            functions: vec![],
        })
    }
}
