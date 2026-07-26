use async_trait::async_trait;
use chrono::{DateTime, NaiveTime, Utc};
use duckdb::types::{TimeUnit, Value as DuckValue};
use duckdb::{params_from_iter, AccessMode, Config, Connection};
use serde_json::{json, Map, Number, Value};
use std::collections::{HashMap, HashSet};
use std::path::{Path, PathBuf};
use std::sync::{Arc, Mutex as StdMutex, OnceLock, Weak};
use std::time::Instant;

use super::filter::{
    build_where_clause, classify_column_type, compile_filter, structured_expression,
    CompiledFilter, FilterDialect, FilterValue,
};
use super::{
    query_returns_rows_with_keywords, DatabaseDriver, DuckDbConfig, MAX_QUERY_RESULT_ROWS,
};
use crate::db::models::{
    ColumnInfo, ForeignKeyInfo, IndexInfo, QueryResult, SchemaOverview, TableDataResponse,
    TableFilter, TableInfo, TableStructure, TableWithStructure, TestConnectionResult,
};

const MAX_SAFE_JSON_INTEGER: i128 = 9_007_199_254_740_991;

static FILE_LOCKS: OnceLock<StdMutex<HashMap<PathBuf, Weak<StdMutex<()>>>>> = OnceLock::new();

#[derive(Clone, Copy)]
enum ConnectionMode {
    Interactive,
    ReadOnly,
}

pub struct DuckDbDriver {
    config: DuckDbConfig,
    file_lock: Arc<StdMutex<()>>,
    interactive_connection: Arc<StdMutex<Option<Connection>>>,
}

impl DuckDbDriver {
    pub fn new(config: DuckDbConfig) -> Self {
        let key = normalized_path(&config.file_path);
        let locks = FILE_LOCKS.get_or_init(|| StdMutex::new(HashMap::new()));
        let mut locks = locks.lock().expect("DuckDB file lock registry poisoned");
        let file_lock = locks.get(&key).and_then(Weak::upgrade).unwrap_or_else(|| {
            let lock = Arc::new(StdMutex::new(()));
            locks.insert(key, Arc::downgrade(&lock));
            lock
        });

        Self {
            config,
            file_lock,
            interactive_connection: Arc::new(StdMutex::new(None)),
        }
    }

    async fn run_blocking<T, F>(&self, mode: ConnectionMode, operation: F) -> Result<T, String>
    where
        T: Send + 'static,
        F: FnOnce(&Connection) -> Result<T, String> + Send + 'static,
    {
        let file_lock = Arc::clone(&self.file_lock);
        let path = self.config.file_path.clone();
        let interactive_connection = Arc::clone(&self.interactive_connection);
        tokio::task::spawn_blocking(move || {
            let _guard = file_lock
                .lock()
                .map_err(|_| "DuckDB file lock poisoned".to_string())?;
            match mode {
                ConnectionMode::Interactive => {
                    let mut connection = interactive_connection
                        .lock()
                        .map_err(|_| "DuckDB connection lock poisoned".to_string())?;
                    if connection.is_none() {
                        *connection = Some(open_connection(&path, mode)?);
                    }
                    operation(connection.as_ref().expect("DuckDB connection initialized"))
                }
                ConnectionMode::ReadOnly => {
                    let connection = open_connection(&path, mode)?;
                    operation(&connection)
                }
            }
        })
        .await
        .map_err(|error| format!("DuckDB operation failed: {error}"))?
    }

    fn bind_filter_values(filter: Option<&CompiledFilter>) -> Vec<DuckValue> {
        filter
            .map(|filter| {
                filter
                    .values
                    .iter()
                    .map(|value| match value {
                        FilterValue::Text(value) => DuckValue::Text(value.clone()),
                        FilterValue::Integer(value) => DuckValue::BigInt(*value),
                        FilterValue::Float(value) => DuckValue::Double(*value),
                        FilterValue::Boolean(value) => DuckValue::Boolean(*value),
                        FilterValue::ExactNumber { value, .. } => DuckValue::Text(value.clone()),
                    })
                    .collect()
            })
            .unwrap_or_default()
    }

    fn table_structure_sync(
        connection: &Connection,
        schema: &str,
        table: &str,
    ) -> Result<TableStructure, String> {
        let columns = query_rows(
            connection,
            "SELECT column_name, data_type, is_nullable = 'YES' AS nullable, column_default \
             FROM information_schema.columns \
             WHERE table_catalog = current_catalog() AND table_schema = ? AND table_name = ? \
             ORDER BY ordinal_position",
            vec![
                DuckValue::Text(schema.to_string()),
                DuckValue::Text(table.to_string()),
            ],
            usize::MAX,
        )?
        .0;

        let constraints = query_rows(
            connection,
            "SELECT constraint_name, constraint_type, constraint_column_names, \
                    referenced_table, referenced_column_names \
             FROM duckdb_constraints() \
             WHERE database_name = current_catalog() AND schema_name = ? AND table_name = ?",
            vec![
                DuckValue::Text(schema.to_string()),
                DuckValue::Text(table.to_string()),
            ],
            usize::MAX,
        )?
        .0;

        let primary_columns: HashSet<String> = constraints
            .iter()
            .filter(|row| row["constraint_type"] == "PRIMARY KEY")
            .flat_map(|row| string_array(&row["constraint_column_names"]))
            .collect();

        let columns = columns
            .into_iter()
            .map(|row| {
                let name = required_string(&row, "column_name")?;
                let data_type = required_string(&row, "data_type")?;
                Ok(ColumnInfo {
                    filter_kind: classify_column_type(&data_type, FilterDialect::DuckDb),
                    name: name.clone(),
                    data_type,
                    nullable: row["nullable"].as_bool().unwrap_or(true),
                    default: row["column_default"].as_str().map(ToOwned::to_owned),
                    primary_key: primary_columns.contains(&name),
                })
            })
            .collect::<Result<Vec<_>, String>>()?;

        let mut indexes = Vec::new();
        let mut foreign_keys = Vec::new();
        for row in &constraints {
            let constraint_type = row["constraint_type"].as_str().unwrap_or_default();
            if constraint_type == "PRIMARY KEY" || constraint_type == "UNIQUE" {
                indexes.push(IndexInfo {
                    name: required_string(row, "constraint_name")?,
                    columns: string_array(&row["constraint_column_names"]),
                    unique: true,
                    primary: constraint_type == "PRIMARY KEY",
                });
            } else if constraint_type == "FOREIGN KEY" {
                let name = required_string(row, "constraint_name")?;
                let local_columns = string_array(&row["constraint_column_names"]);
                let referenced_columns = string_array(&row["referenced_column_names"]);
                let referenced_table = required_string(row, "referenced_table")?;
                for (column, references_column) in local_columns.into_iter().zip(referenced_columns)
                {
                    foreign_keys.push(ForeignKeyInfo {
                        name: name.clone(),
                        column,
                        references_table: referenced_table.clone(),
                        references_column,
                    });
                }
            }
        }

        let secondary_indexes = query_rows(
            connection,
            "SELECT index_name, is_unique FROM duckdb_indexes() \
             WHERE database_name = current_catalog() AND schema_name = ? AND table_name = ?",
            vec![
                DuckValue::Text(schema.to_string()),
                DuckValue::Text(table.to_string()),
            ],
            usize::MAX,
        )?
        .0;
        for row in secondary_indexes {
            indexes.push(IndexInfo {
                name: required_string(&row, "index_name")?,
                columns: Vec::new(),
                unique: row["is_unique"].as_bool().unwrap_or(false),
                primary: false,
            });
        }

        Ok(TableStructure {
            columns,
            indexes,
            foreign_keys,
        })
    }
}

#[async_trait]
impl DatabaseDriver for DuckDbDriver {
    async fn test_connection(&self) -> Result<TestConnectionResult, String> {
        self.run_blocking(ConnectionMode::Interactive, |connection| {
            connection
                .query_row("SELECT 1", [], |_| Ok(()))
                .map_err(|error| error.to_string())?;
            Ok(TestConnectionResult {
                success: true,
                message: "Connection successful!".to_string(),
            })
        })
        .await
    }

    async fn list_tables(&self) -> Result<Vec<TableInfo>, String> {
        self.run_blocking(ConnectionMode::Interactive, |connection| {
            let rows = query_rows(
                connection,
                "SELECT table_schema, table_name, \
                        CASE WHEN table_type = 'VIEW' THEN 'view' ELSE 'table' END AS object_type \
                 FROM information_schema.tables \
                 WHERE table_catalog = current_catalog() \
                   AND table_schema NOT IN ('information_schema', 'pg_catalog') \
                 ORDER BY table_schema, table_name",
                Vec::new(),
                usize::MAX,
            )?
            .0;
            rows.into_iter()
                .map(|row| {
                    Ok(TableInfo {
                        schema: required_string(&row, "table_schema")?,
                        name: required_string(&row, "table_name")?,
                        table_type: required_string(&row, "object_type")?,
                    })
                })
                .collect()
        })
        .await
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
        let structure = self.get_table_structure(schema, table).await?;
        let compiled = structured_expression(filter.as_ref())
            .map(|expression| compile_filter(expression, &structure.columns, FilterDialect::DuckDb))
            .transpose()?;
        let where_clause = build_where_clause(filter.as_ref(), compiled.as_ref());
        let values = Self::bind_filter_values(compiled.as_ref());
        let table_ref = qualified_name(schema, table);
        let page = page.max(1);
        let limit = limit.clamp(1, 1_000);
        let offset = (page - 1) * limit;

        let order_columns = if let Some(column) = sort_column {
            if !structure
                .columns
                .iter()
                .any(|candidate| candidate.name == column)
            {
                return Err(format!("Unknown sort column: {column}"));
            }
            vec![column]
        } else {
            structure
                .columns
                .iter()
                .filter(|column| column.primary_key)
                .map(|column| column.name.clone())
                .collect()
        };
        let order_direction = if sort_direction
            .as_deref()
            .is_some_and(|direction| direction.eq_ignore_ascii_case("desc"))
        {
            "DESC"
        } else {
            "ASC"
        };
        let order_clause = if order_columns.is_empty() {
            String::new()
        } else {
            let columns = order_columns
                .iter()
                .map(|column| format!("{} {order_direction}", quote_identifier(column)))
                .collect::<Vec<_>>()
                .join(", ");
            format!(" ORDER BY {columns}")
        };
        let count_sql = format!("SELECT COUNT(*) AS total FROM {table_ref}{where_clause}");
        let data_sql = format!(
            "SELECT * FROM {table_ref}{where_clause}{order_clause} LIMIT {limit} OFFSET {offset}"
        );

        self.run_blocking(ConnectionMode::Interactive, move |connection| {
            let count = query_rows(connection, &count_sql, values.clone(), 1)?
                .0
                .first()
                .and_then(|row| {
                    row["total"]
                        .as_i64()
                        .or_else(|| row["total"].as_str()?.parse().ok())
                })
                .unwrap_or(0);
            let data = query_rows(connection, &data_sql, values, usize::MAX)?.0;
            Ok(TableDataResponse {
                data,
                total: count,
                page,
                limit,
            })
        })
        .await
    }

    async fn get_table_structure(
        &self,
        schema: &str,
        table: &str,
    ) -> Result<TableStructure, String> {
        let schema = schema.to_string();
        let table = table.to_string();
        self.run_blocking(ConnectionMode::Interactive, move |connection| {
            Self::table_structure_sync(connection, &schema, &table)
        })
        .await
    }

    async fn execute_query(&self, query: &str) -> Result<QueryResult, String> {
        let query = query.to_string();
        self.run_blocking(ConnectionMode::Interactive, move |connection| {
            execute_query(connection, &query)
        })
        .await
    }

    async fn execute_query_read_only(&self, query: &str) -> Result<QueryResult, String> {
        let query = query.to_string();
        self.run_blocking(ConnectionMode::ReadOnly, move |connection| {
            execute_query(connection, &query)
        })
        .await
    }

    async fn get_schema_overview(&self) -> Result<SchemaOverview, String> {
        let objects = self.list_tables().await?;
        let mut tables = Vec::with_capacity(objects.len());
        for object in objects {
            let structure = self
                .get_table_structure(&object.schema, &object.name)
                .await?;
            tables.push(TableWithStructure {
                schema: object.schema,
                name: object.name,
                table_type: object.table_type,
                columns: structure.columns,
                foreign_keys: structure.foreign_keys,
                indexes: structure.indexes,
            });
        }
        Ok(SchemaOverview {
            tables,
            functions: Vec::new(),
        })
    }
}

fn normalized_path(path: &str) -> PathBuf {
    let path = Path::new(path);
    if let Ok(path) = path.canonicalize() {
        return path;
    }
    let file_name = path.file_name().map(ToOwned::to_owned);
    match (
        path.parent().and_then(|parent| parent.canonicalize().ok()),
        file_name,
    ) {
        (Some(parent), Some(file_name)) => parent.join(file_name),
        _ => path.to_path_buf(),
    }
}

fn open_connection(path: &str, mode: ConnectionMode) -> Result<Connection, String> {
    let config = match mode {
        ConnectionMode::Interactive => Config::default()
            .access_mode(AccessMode::ReadWrite)
            .and_then(|config| config.enable_external_access(true))
            .and_then(|config| config.enable_autoload_extension(true))
            .and_then(|config| config.with("allow_community_extensions", "false")),
        ConnectionMode::ReadOnly => Config::default()
            .access_mode(AccessMode::ReadOnly)
            .and_then(|config| config.enable_external_access(false))
            .and_then(|config| config.enable_autoload_extension(false))
            .and_then(|config| config.with("allow_community_extensions", "false"))
            .and_then(|config| config.with("lock_configuration", "true")),
    }
    .map_err(|error| error.to_string())?;
    Connection::open_with_flags(path, config).map_err(|error| error.to_string())
}

fn execute_query(connection: &Connection, query: &str) -> Result<QueryResult, String> {
    let start = Instant::now();
    let returns_rows = duckdb_query_returns_rows(query);
    let mut statement = match connection.prepare(query) {
        Ok(statement) => statement,
        Err(error) => return Ok(QueryResult::from_error(error.to_string(), start)),
    };

    if returns_rows {
        return match query_statement(&mut statement, Vec::new(), MAX_QUERY_RESULT_ROWS) {
            Ok((data, truncated)) => Ok(QueryResult::from_rows(data, truncated, start)),
            Err(error) => Ok(QueryResult::from_error(error, start)),
        };
    }

    match statement.execute([]) {
        Ok(rows_affected) => Ok(QueryResult {
            data: Vec::new(),
            row_count: 0,
            truncated: false,
            rows_affected: Some(rows_affected as u64),
            error: None,
            time_taken_ms: Some(start.elapsed().as_millis()),
        }),
        Err(error) => Ok(QueryResult::from_error(error.to_string(), start)),
    }
}

fn duckdb_query_returns_rows(query: &str) -> bool {
    query_returns_rows_with_keywords(query, &["FROM", "SUMMARIZE", "PIVOT", "UNPIVOT"])
}

fn query_rows(
    connection: &Connection,
    sql: &str,
    values: Vec<DuckValue>,
    max_rows: usize,
) -> Result<(Vec<Value>, bool), String> {
    let mut statement = connection.prepare(sql).map_err(|error| error.to_string())?;
    query_statement(&mut statement, values, max_rows)
}

fn query_statement(
    statement: &mut duckdb::Statement<'_>,
    values: Vec<DuckValue>,
    max_rows: usize,
) -> Result<(Vec<Value>, bool), String> {
    let rows = statement
        .query(params_from_iter(values.iter()))
        .map_err(|error| error.to_string())?;
    let column_names = rows
        .as_ref()
        .ok_or_else(|| "DuckDB query returned no statement metadata".to_string())?
        .column_names();
    let mut rows = rows;
    let mut data = Vec::new();
    while let Some(row) = rows.next().map_err(|error| error.to_string())? {
        if data.len() == max_rows {
            return Ok((data, true));
        }
        let mut object = Map::new();
        for (index, column) in column_names.iter().enumerate() {
            let value = row
                .get::<_, DuckValue>(index)
                .map_err(|error| error.to_string())?;
            object.insert(column.clone(), duck_value_to_json(value)?);
        }
        data.push(Value::Object(object));
    }
    Ok((data, false))
}

fn duck_value_to_json(value: DuckValue) -> Result<Value, String> {
    let value = match value {
        DuckValue::Null => Value::Null,
        DuckValue::Boolean(value) => json!(value),
        DuckValue::TinyInt(value) => json!(value),
        DuckValue::SmallInt(value) => json!(value),
        DuckValue::Int(value) => json!(value),
        DuckValue::BigInt(value) if i128::from(value).abs() <= MAX_SAFE_JSON_INTEGER => {
            json!(value)
        }
        DuckValue::BigInt(value) => json!(value.to_string()),
        DuckValue::HugeInt(value) if value.abs() <= MAX_SAFE_JSON_INTEGER => json!(value as i64),
        DuckValue::HugeInt(value) => json!(value.to_string()),
        DuckValue::UHugeInt(value) if value <= MAX_SAFE_JSON_INTEGER as u128 => json!(value as u64),
        DuckValue::UHugeInt(value) => json!(value.to_string()),
        DuckValue::UTinyInt(value) => json!(value),
        DuckValue::USmallInt(value) => json!(value),
        DuckValue::UInt(value) => json!(value),
        DuckValue::UBigInt(value) if value <= MAX_SAFE_JSON_INTEGER as u64 => json!(value),
        DuckValue::UBigInt(value) => json!(value.to_string()),
        DuckValue::Float(value) => Number::from_f64(value.into())
            .map(Value::Number)
            .unwrap_or_else(|| json!(value.to_string())),
        DuckValue::Double(value) => Number::from_f64(value)
            .map(Value::Number)
            .unwrap_or_else(|| json!(value.to_string())),
        DuckValue::Decimal(value) => json!(value.to_string()),
        DuckValue::Timestamp(unit, value) => json!(format_timestamp(unit, value)),
        DuckValue::Text(value) | DuckValue::Enum(value) => json!(value),
        DuckValue::Blob(value) | DuckValue::Geometry(value) => {
            json!(format!("\\x{}", hex::encode_upper(value)))
        }
        DuckValue::Date32(days) => json!(format_date(days)),
        DuckValue::Time64(unit, value) => json!(format_time(unit, value)),
        DuckValue::Interval {
            months,
            days,
            nanos,
        } => {
            json!(format!(
                "P{months}M{days}DT{}S",
                nanos as f64 / 1_000_000_000.0
            ))
        }
        DuckValue::List(values) | DuckValue::Array(values) => Value::Array(
            values
                .into_iter()
                .map(duck_value_to_json)
                .collect::<Result<Vec<_>, _>>()?,
        ),
        DuckValue::Struct(values) => {
            let values = values
                .iter()
                .map(|(key, value)| Ok((key.clone(), duck_value_to_json(value.clone())?)))
                .collect::<Result<Map<_, _>, String>>()?;
            Value::Object(values)
        }
        DuckValue::Map(values) => {
            let values = values
                .iter()
                .map(|(key, value)| {
                    Ok(json!({
                        "key": duck_value_to_json(key.clone())?,
                        "value": duck_value_to_json(value.clone())?
                    }))
                })
                .collect::<Result<Vec<_>, String>>()?;
            Value::Array(values)
        }
        DuckValue::Union(value) => return duck_value_to_json(*value),
        unsupported => return Err(format!("Unsupported DuckDB value type: {unsupported:?}")),
    };
    Ok(value)
}

fn format_timestamp(unit: TimeUnit, value: i64) -> String {
    let micros = unit.to_micros(value);
    let seconds = micros.div_euclid(1_000_000);
    let nanos = micros.rem_euclid(1_000_000) as u32 * 1_000;
    DateTime::<Utc>::from_timestamp(seconds, nanos)
        .map(|value| value.naive_utc().to_string())
        .unwrap_or_else(|| value.to_string())
}

fn format_date(days: i32) -> String {
    DateTime::<Utc>::from_timestamp(i64::from(days) * 86_400, 0)
        .map(|value| value.date_naive().to_string())
        .unwrap_or_else(|| days.to_string())
}

fn format_time(unit: TimeUnit, value: i64) -> String {
    let micros = unit.to_micros(value);
    let seconds = micros.div_euclid(1_000_000);
    let nanos = micros.rem_euclid(1_000_000) as u32 * 1_000;
    NaiveTime::from_num_seconds_from_midnight_opt(seconds as u32, nanos)
        .map(|value| value.to_string())
        .unwrap_or_else(|| value.to_string())
}

fn qualified_name(schema: &str, table: &str) -> String {
    format!("{}.{}", quote_identifier(schema), quote_identifier(table))
}

fn quote_identifier(identifier: &str) -> String {
    format!("\"{}\"", identifier.replace('"', "\"\""))
}

fn required_string(row: &Value, key: &str) -> Result<String, String> {
    row[key]
        .as_str()
        .map(ToOwned::to_owned)
        .ok_or_else(|| format!("DuckDB metadata did not return {key}"))
}

fn string_array(value: &Value) -> Vec<String> {
    value
        .as_array()
        .map(|values| {
            values
                .iter()
                .filter_map(Value::as_str)
                .map(ToOwned::to_owned)
                .collect()
        })
        .unwrap_or_default()
}

#[cfg(test)]
mod tests {
    use super::{duck_value_to_json, ConnectionMode, DuckDbConfig, DuckDbDriver};
    use duckdb::types::Value as DuckValue;
    use serde_json::json;
    use std::sync::{mpsc, Arc};
    use std::time::Duration;
    use tempfile::tempdir;

    #[tokio::test(flavor = "multi_thread", worker_threads = 2)]
    async fn cancelled_call_keeps_file_lock_until_blocking_work_finishes() {
        let temp_dir = tempdir().unwrap();
        let file_path = temp_dir
            .path()
            .join("analytics.duckdb")
            .to_string_lossy()
            .to_string();
        let first = Arc::new(DuckDbDriver::new(DuckDbConfig {
            file_path: file_path.clone(),
        }));
        let second = Arc::new(DuckDbDriver::new(DuckDbConfig { file_path }));
        let (started_tx, started_rx) = mpsc::channel();
        let (release_tx, release_rx) = mpsc::channel();

        let first_task = tokio::spawn({
            let first = Arc::clone(&first);
            async move {
                first
                    .run_blocking(ConnectionMode::Interactive, move |_| {
                        started_tx.send(()).unwrap();
                        release_rx.recv().unwrap();
                        Ok(())
                    })
                    .await
            }
        });
        tokio::task::spawn_blocking(move || started_rx.recv_timeout(Duration::from_secs(2)))
            .await
            .unwrap()
            .unwrap();

        first_task.abort();
        let _ = first_task.await;

        let (second_entered_tx, second_entered_rx) = mpsc::channel();
        let second_task = tokio::spawn(async move {
            second
                .run_blocking(ConnectionMode::Interactive, move |_| {
                    let _ = second_entered_tx.send(());
                    Ok(())
                })
                .await
        });
        let entered_before_release = tokio::task::spawn_blocking(move || {
            second_entered_rx
                .recv_timeout(Duration::from_millis(300))
                .is_ok()
        })
        .await
        .unwrap();

        release_tx.send(()).unwrap();
        second_task.await.unwrap().unwrap();

        assert!(!entered_before_release);
    }

    #[test]
    fn converts_supported_values_through_a_fallible_boundary() {
        assert_eq!(duck_value_to_json(DuckValue::Int(7)).unwrap(), json!(7));
        assert_eq!(
            duck_value_to_json(DuckValue::List(vec![DuckValue::Text("ok".to_string())])).unwrap(),
            json!(["ok"])
        );
    }
}
