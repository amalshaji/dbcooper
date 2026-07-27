use async_trait::async_trait;
use serde_json::Value;
use std::collections::{HashMap, HashSet};
use std::path::PathBuf;
use std::process::Stdio;
use std::sync::{Arc, Mutex as StdMutex, OnceLock, Weak};
use std::time::Instant;
use tokio::io::{AsyncBufReadExt, AsyncReadExt, AsyncWriteExt, BufReader, Lines};
use tokio::process::{Child, ChildStderr, ChildStdin, ChildStdout, Command};
use tokio::sync::Mutex;
use tokio::time::{timeout, Duration};

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
use crate::duckdb_helper;

const MAX_SAFE_JSON_INTEGER: i64 = 9_007_199_254_740_991;
const MAX_CLI_OUTPUT_BYTES: usize = 64 * 1024 * 1024;
const MAX_CLI_ERROR_BYTES: usize = 1024 * 1024;
static FILE_LOCKS: OnceLock<StdMutex<HashMap<PathBuf, Weak<Mutex<()>>>>> = OnceLock::new();

pub struct DuckDbDriver {
    config: DuckDbConfig,
    helper_path: PathBuf,
    managed_helper: bool,
    file_lock: Arc<Mutex<()>>,
    interactive_session: Arc<Mutex<Option<DuckDbSession>>>,
}

enum DuckDbSessionError {
    Query(String),
    Transport(String),
}

impl DuckDbSessionError {
    fn into_message(self) -> String {
        match self {
            Self::Query(message) | Self::Transport(message) => message,
        }
    }
}

impl DuckDbDriver {
    pub fn new(config: DuckDbConfig) -> Self {
        let helper_path = duckdb_helper::helper_path().unwrap_or_default();
        Self::build(config, helper_path, true)
    }

    pub fn with_helper_path(config: DuckDbConfig, helper_path: PathBuf) -> Self {
        Self::build(config, helper_path, false)
    }

    fn build(config: DuckDbConfig, helper_path: PathBuf, managed_helper: bool) -> Self {
        let key = normalized_path(&config.file_path);
        let locks = FILE_LOCKS.get_or_init(|| StdMutex::new(HashMap::new()));
        let mut locks = locks.lock().expect("DuckDB file lock registry poisoned");
        let file_lock = locks.get(&key).and_then(Weak::upgrade).unwrap_or_else(|| {
            let lock = Arc::new(Mutex::new(()));
            locks.insert(key, Arc::downgrade(&lock));
            lock
        });
        Self {
            config,
            helper_path,
            managed_helper,
            file_lock,
            interactive_session: Arc::new(Mutex::new(None)),
        }
    }

    async fn query_rows(&self, sql: &str) -> Result<Vec<Value>, String> {
        self.run_cli(sql, false).await
    }

    async fn ensure_helper_available(&self) -> Result<(), String> {
        if self.managed_helper && !duckdb_helper::is_helper_installed() {
            duckdb_helper::ensure_duckdb_helper_silent().await?;
        }
        if self.helper_path.is_file() {
            Ok(())
        } else {
            Err("DuckDB helper is not installed. Reconnect to download it.".to_string())
        }
    }

    async fn run_cli(&self, sql: &str, read_only: bool) -> Result<Vec<Value>, String> {
        self.ensure_helper_available().await?;
        let _guard = self.file_lock.lock().await;
        self.run_cli_locked(sql, read_only).await
    }

    async fn run_cli_locked(&self, sql: &str, read_only: bool) -> Result<Vec<Value>, String> {
        if read_only {
            let session = self.interactive_session.lock().await;
            if session.is_some() {
                return Err(
                    "Read-only access is unavailable while an active DuckDB session owns the database; disconnect the workspace and retry"
                        .to_string(),
                );
            }
            drop(session);
            return run_cli_once(&self.helper_path, &self.config.file_path, sql, true).await;
        }

        let mut session = self.interactive_session.lock().await;
        if session.is_none() {
            *session = Some(DuckDbSession::start(&self.helper_path, &self.config.file_path).await?);
        }
        let mut active = session.take().expect("DuckDB session initialized");
        match active.execute(sql).await {
            Ok(rows) => {
                *session = Some(active);
                Ok(rows)
            }
            Err(DuckDbSessionError::Query(message)) => {
                *session = Some(active);
                Err(message)
            }
            Err(error @ DuckDbSessionError::Transport(_)) => {
                active.shutdown().await;
                Err(error.into_message())
            }
        }
    }

    async fn table_structure_inner(
        &self,
        schema: &str,
        table: &str,
    ) -> Result<TableStructure, String> {
        let schema = sql_string(schema);
        let table = sql_string(table);
        let columns = self
            .query_rows(&format!(
                "SELECT column_name, data_type, is_nullable = 'YES' AS nullable, column_default \
                 FROM information_schema.columns \
                 WHERE table_catalog = current_catalog() AND table_schema = {schema} AND table_name = {table} \
                 ORDER BY ordinal_position"
            ))
            .await?;
        let constraints = self
            .query_rows(&format!(
                "SELECT constraint_name, constraint_type, constraint_column_names, \
                        referenced_table, referenced_column_names \
                 FROM duckdb_constraints() \
                 WHERE database_name = current_catalog() AND schema_name = {schema} AND table_name = {table}"
            ))
            .await?;
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
        let secondary_indexes = self
            .query_rows(&format!(
                "SELECT index_name, is_unique FROM duckdb_indexes() \
                 WHERE database_name = current_catalog() AND schema_name = {schema} AND table_name = {table}"
            ))
            .await?;
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

struct DuckDbSession {
    child: Child,
    stdin: ChildStdin,
    stdout: Lines<BufReader<ChildStdout>>,
    stderr: Lines<BufReader<ChildStderr>>,
}

impl DuckDbSession {
    async fn start(helper_path: &PathBuf, file_path: &str) -> Result<Self, String> {
        let mut command = duckdb_command(helper_path);
        let mut child = command
            .arg("-batch")
            .arg("-no-init")
            .arg("-json")
            .arg(file_path)
            .stdin(Stdio::piped())
            .stdout(Stdio::piped())
            .stderr(Stdio::piped())
            .kill_on_drop(true)
            .spawn()
            .map_err(|error| format!("Could not start DuckDB helper: {error}"))?;
        let stdin = child
            .stdin
            .take()
            .ok_or_else(|| "Could not open DuckDB helper input".to_string())?;
        let stdout = child
            .stdout
            .take()
            .ok_or_else(|| "Could not open DuckDB helper output".to_string())?;
        let stderr = child
            .stderr
            .take()
            .ok_or_else(|| "Could not open DuckDB helper errors".to_string())?;
        Ok(Self {
            child,
            stdin,
            stdout: BufReader::new(stdout).lines(),
            stderr: BufReader::new(stderr).lines(),
        })
    }

    async fn execute(&mut self, sql: &str) -> Result<Vec<Value>, DuckDbSessionError> {
        let marker = format!("__dbcooper_{}", uuid::Uuid::new_v4().simple());
        self.stdin
            .write_all(sql.as_bytes())
            .await
            .map_err(|error| {
                DuckDbSessionError::Transport(format!(
                    "Could not send query to DuckDB helper: {error}"
                ))
            })?;
        if !sql.trim_end().ends_with(';') {
            self.stdin.write_all(b";").await.map_err(|error| {
                DuckDbSessionError::Transport(format!(
                    "Could not send query to DuckDB helper: {error}"
                ))
            })?;
        }
        self.stdin
            .write_all(format!("\nSELECT '{marker}' AS __dbcooper_marker;\n").as_bytes())
            .await
            .map_err(|error| {
                DuckDbSessionError::Transport(format!(
                    "Could not send query to DuckDB helper: {error}"
                ))
            })?;
        self.stdin.flush().await.map_err(|error| {
            DuckDbSessionError::Transport(format!("Could not send query to DuckDB helper: {error}"))
        })?;

        let mut output = String::new();
        let mut errors = Vec::new();
        let mut error_bytes = 0;
        let mut stderr_open = true;
        loop {
            tokio::select! {
                line = self.stderr.next_line(), if stderr_open => match line {
                    Ok(Some(line)) => {
                        error_bytes += line.len();
                        if error_bytes > MAX_CLI_ERROR_BYTES {
                            let _ = self.child.kill().await;
                            return Err(DuckDbSessionError::Transport("DuckDB query returned too many errors".to_string()));
                        }
                        errors.push(line);
                    },
                    Ok(None) => stderr_open = false,
                    Err(error) => return Err(DuckDbSessionError::Transport(format!("Could not read DuckDB helper errors: {error}"))),
                },
                line = self.stdout.next_line() => match line {
                    Ok(Some(line)) if line.contains(&marker) => break,
                    Ok(Some(line)) => {
                        if output.len() + line.len() > MAX_CLI_OUTPUT_BYTES {
                            let _ = self.child.kill().await;
                            return Err(DuckDbSessionError::Transport("DuckDB query output exceeds the 64 MB safety limit".to_string()));
                        }
                        output.push_str(&line);
                        output.push('\n');
                    }
                    Ok(None) => return Err(DuckDbSessionError::Transport("DuckDB helper exited before completing the query".to_string())),
                    Err(error) => return Err(DuckDbSessionError::Transport(format!("Could not read DuckDB helper output: {error}"))),
                },
            }
        }
        while stderr_open {
            match timeout(Duration::from_millis(2), self.stderr.next_line()).await {
                Ok(Ok(Some(line))) => {
                    error_bytes += line.len();
                    if error_bytes > MAX_CLI_ERROR_BYTES {
                        let _ = self.child.kill().await;
                        return Err(DuckDbSessionError::Transport(
                            "DuckDB query returned too many errors".to_string(),
                        ));
                    }
                    errors.push(line);
                }
                Ok(Ok(None)) => stderr_open = false,
                Ok(Err(error)) => {
                    return Err(DuckDbSessionError::Transport(format!(
                        "Could not read DuckDB helper errors: {error}"
                    )))
                }
                Err(_) => break,
            }
        }
        if !errors.is_empty() {
            return Err(DuckDbSessionError::Query(errors.join("\n")));
        }
        parse_cli_output(output.as_bytes()).map_err(DuckDbSessionError::Transport)
    }

    async fn shutdown(&mut self) {
        let _ = self.stdin.write_all(b".quit\n").await;
        let _ = self.stdin.flush().await;
        if timeout(Duration::from_secs(1), self.child.wait())
            .await
            .is_err()
        {
            let _ = self.child.kill().await;
        }
    }
}

async fn run_cli_once(
    helper_path: &PathBuf,
    file_path: &str,
    sql: &str,
    read_only: bool,
) -> Result<Vec<Value>, String> {
    let mut command = duckdb_command(helper_path);
    command
        .arg("-batch")
        .arg("-bail")
        .arg("-no-init")
        .arg("-json");
    if read_only {
        command.arg("-safe").arg("-readonly");
    }
    command
        .arg(file_path)
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .kill_on_drop(true);
    let mut child = command
        .spawn()
        .map_err(|error| format!("Could not start DuckDB helper: {error}"))?;
    let mut stdin = child
        .stdin
        .take()
        .ok_or_else(|| "Could not open DuckDB helper input".to_string())?;
    let stdout = child
        .stdout
        .take()
        .ok_or_else(|| "Could not open DuckDB helper output".to_string())?;
    let mut stderr = child
        .stderr
        .take()
        .ok_or_else(|| "Could not open DuckDB helper errors".to_string())?;
    stdin
        .write_all(sql.as_bytes())
        .await
        .map_err(|error| format!("Could not send query to DuckDB helper: {error}"))?;
    drop(stdin);
    let stderr_task = tokio::spawn(async move {
        let mut bytes = Vec::new();
        let mut buffer = [0_u8; 8192];
        loop {
            let read = stderr
                .read(&mut buffer)
                .await
                .map_err(|error| format!("Could not read DuckDB helper errors: {error}"))?;
            if read == 0 {
                break;
            }
            let remaining = MAX_CLI_ERROR_BYTES.saturating_sub(bytes.len());
            bytes.extend_from_slice(&buffer[..read.min(remaining)]);
        }
        Ok::<_, String>(bytes)
    });
    let mut output = Vec::new();
    stdout
        .take((MAX_CLI_OUTPUT_BYTES + 1) as u64)
        .read_to_end(&mut output)
        .await
        .map_err(|error| format!("Could not read DuckDB helper output: {error}"))?;
    if output.len() > MAX_CLI_OUTPUT_BYTES {
        let _ = child.kill().await;
        let _ = child.wait().await;
        let _ = stderr_task.await;
        return Err("DuckDB query output exceeds the 64 MB safety limit".to_string());
    }
    let status = child
        .wait()
        .await
        .map_err(|error| format!("DuckDB helper failed: {error}"))?;
    let stderr = stderr_task
        .await
        .map_err(|error| format!("Could not read DuckDB helper errors: {error}"))??;
    if !status.success() {
        let error = String::from_utf8_lossy(&stderr).trim().to_string();
        return Err(if error.is_empty() {
            "DuckDB query failed".to_string()
        } else {
            error
        });
    }
    parse_cli_output(&output)
}

fn duckdb_command(helper_path: &PathBuf) -> Command {
    #[cfg(windows)]
    {
        let mut command = Command::new(helper_path);
        command.creation_flags(0x08000000);
        command
    }
    #[cfg(not(windows))]
    {
        Command::new(helper_path)
    }
}

#[async_trait]
impl DatabaseDriver for DuckDbDriver {
    async fn test_connection(&self) -> Result<TestConnectionResult, String> {
        self.ensure_helper_available().await?;
        let _guard = self.file_lock.lock().await;
        if self.interactive_session.lock().await.is_some() {
            self.run_cli_locked("SELECT 1", false).await?;
        } else {
            run_cli_once(&self.helper_path, &self.config.file_path, "SELECT 1", false).await?;
        }
        Ok(TestConnectionResult {
            success: true,
            message: "Connection successful!".to_string(),
        })
    }

    async fn list_tables(&self) -> Result<Vec<TableInfo>, String> {
        self.query_rows(
            "SELECT table_schema, table_name, \
                    CASE WHEN table_type = 'VIEW' THEN 'view' ELSE 'table' END AS object_type \
             FROM information_schema.tables \
             WHERE table_catalog = current_catalog() \
               AND table_schema NOT IN ('information_schema', 'pg_catalog') \
             ORDER BY table_schema, table_name",
        )
        .await?
        .into_iter()
        .map(|row| {
            Ok(TableInfo {
                schema: required_string(&row, "table_schema")?,
                name: required_string(&row, "table_name")?,
                table_type: required_string(&row, "object_type")?,
            })
        })
        .collect()
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
        let mut where_clause = build_where_clause(filter.as_ref(), compiled.as_ref());
        if let Some(compiled) = compiled.as_ref() {
            where_clause = render_filter(&where_clause, compiled)?;
        }
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
            format!(
                " ORDER BY {}",
                order_columns
                    .iter()
                    .map(|column| format!("{} {order_direction}", quote_identifier(column)))
                    .collect::<Vec<_>>()
                    .join(", ")
            )
        };
        let count_rows = self
            .query_rows(&format!(
                "SELECT COUNT(*) AS total FROM {table_ref}{where_clause}"
            ))
            .await?;
        let total = count_rows
            .first()
            .and_then(|row| {
                row["total"]
                    .as_i64()
                    .or_else(|| row["total"].as_str()?.parse().ok())
            })
            .unwrap_or(0);
        let data = self
            .query_rows(&format!(
                "SELECT * FROM {table_ref}{where_clause}{order_clause} LIMIT {limit} OFFSET {offset}"
            ))
            .await?;
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
        self.table_structure_inner(schema, table).await
    }

    async fn execute_query(&self, query: &str) -> Result<QueryResult, String> {
        execute_query(self, query, false).await
    }

    async fn execute_query_read_only(&self, query: &str) -> Result<QueryResult, String> {
        execute_query(self, query, true).await
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

async fn execute_query(
    driver: &DuckDbDriver,
    query: &str,
    read_only: bool,
) -> Result<QueryResult, String> {
    let start = Instant::now();
    match driver.run_cli(query, read_only).await {
        Ok(mut data) => {
            if !duckdb_query_returns_rows(query) {
                data.clear();
            }
            let truncated = data.len() > MAX_QUERY_RESULT_ROWS;
            data.truncate(MAX_QUERY_RESULT_ROWS);
            Ok(QueryResult {
                row_count: data.len() as i64,
                data,
                truncated,
                rows_affected: None,
                error: None,
                time_taken_ms: Some(start.elapsed().as_millis()),
            })
        }
        Err(error) => Ok(QueryResult::from_error(error, start)),
    }
}

fn duckdb_query_returns_rows(query: &str) -> bool {
    query_returns_rows_with_keywords(query, &["FROM", "SUMMARIZE", "PIVOT", "UNPIVOT"])
}

fn parse_cli_output(output: &[u8]) -> Result<Vec<Value>, String> {
    let text = std::str::from_utf8(output)
        .map_err(|error| format!("DuckDB helper returned invalid UTF-8: {error}"))?;
    let mut last_rows = Vec::new();
    for value in serde_json::Deserializer::from_str(text).into_iter::<Value>() {
        let value =
            value.map_err(|error| format!("DuckDB helper returned invalid JSON: {error}"))?;
        if let Value::Array(rows) = value {
            last_rows = rows;
        }
    }
    for row in &mut last_rows {
        normalize_cli_value(row);
    }
    Ok(last_rows)
}

fn normalize_cli_value(value: &mut Value) {
    match value {
        Value::Number(number) => {
            let unsafe_integer = number
                .as_i64()
                .filter(|value| *value < -MAX_SAFE_JSON_INTEGER || *value > MAX_SAFE_JSON_INTEGER)
                .map(|value| value.to_string())
                .or_else(|| {
                    number
                        .as_u64()
                        .filter(|value| *value > MAX_SAFE_JSON_INTEGER as u64)
                        .map(|value| value.to_string())
                });
            if let Some(integer) = unsafe_integer {
                *value = Value::String(integer);
            }
        }
        Value::String(_) => {}
        Value::Array(values) => values.iter_mut().for_each(normalize_cli_value),
        Value::Object(values) => values.values_mut().for_each(normalize_cli_value),
        _ => {}
    }
}

fn render_filter(where_clause: &str, filter: &CompiledFilter) -> Result<String, String> {
    let mut parts = where_clause.split('?');
    let mut rendered = parts.next().unwrap_or_default().to_string();
    for value in &filter.values {
        rendered.push_str(&filter_value_sql(value)?);
        rendered.push_str(
            parts
                .next()
                .ok_or_else(|| "DuckDB filter parameter mismatch".to_string())?,
        );
    }
    if parts.next().is_some() {
        return Err("DuckDB filter parameter mismatch".to_string());
    }
    Ok(rendered)
}

fn filter_value_sql(value: &FilterValue) -> Result<String, String> {
    match value {
        FilterValue::Text(value) => Ok(sql_string(value)),
        FilterValue::Integer(value) => Ok(value.to_string()),
        FilterValue::Float(value) if value.is_finite() => Ok(value.to_string()),
        FilterValue::Float(_) => Err("DuckDB filter number must be finite".to_string()),
        FilterValue::Boolean(value) => Ok(value.to_string()),
        FilterValue::ExactNumber { value, .. }
            if value.chars().all(|character| {
                character.is_ascii_digit() || matches!(character, '+' | '-' | '.' | 'e' | 'E')
            }) =>
        {
            Ok(value.clone())
        }
        FilterValue::ExactNumber { .. } => Err("Invalid DuckDB numeric filter".to_string()),
    }
}

fn normalized_path(path: &str) -> PathBuf {
    let path = std::path::Path::new(path);
    if let Ok(path) = path.canonicalize() {
        return path;
    }
    match (
        path.parent().and_then(|parent| parent.canonicalize().ok()),
        path.file_name(),
    ) {
        (Some(parent), Some(file_name)) => parent.join(file_name),
        _ => path.to_path_buf(),
    }
}

fn qualified_name(schema: &str, table: &str) -> String {
    format!("{}.{}", quote_identifier(schema), quote_identifier(table))
}

fn quote_identifier(identifier: &str) -> String {
    format!("\"{}\"", identifier.replace('"', "\"\""))
}

fn sql_string(value: &str) -> String {
    format!("'{}'", value.replace('\'', "''"))
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
    use super::{normalize_cli_value, render_filter, CompiledFilter, DuckDbDriver, FilterValue};
    use crate::database::{DatabaseDriver, DuckDbConfig};
    use serde_json::json;
    use std::path::PathBuf;
    use tempfile::tempdir;

    #[cfg(unix)]
    fn fake_cli() -> (tempfile::TempDir, PathBuf) {
        use std::os::unix::fs::PermissionsExt;

        let directory = tempdir().unwrap();
        let path = directory.path().join("duckdb-test-cli");
        std::fs::write(
            &path,
            r#"#!/bin/sh
starts_file="$0.starts"
starts=0
if [ -f "$starts_file" ]; then
  starts=$(cat "$starts_file")
fi
printf '%s\n' "$((starts + 1))" > "$starts_file"
session_value=0
while IFS= read -r line; do
  case "$line" in
    SELECT\ \'__dbcooper_*) printf '%s\n' "$line" ;;
    *BREAK_SESSION*) exit 1 ;;
    *SET_SESSION*) session_value=1; printf '[]\n' ;;
    *CHECK_SESSION*) printf '[{"value":%s}]\n' "$session_value" ;;
    *) printf '[{"value":1}]\n' ;;
  esac
done
"#,
        )
        .unwrap();
        std::fs::set_permissions(&path, std::fs::Permissions::from_mode(0o700)).unwrap();
        (directory, path)
    }

    #[cfg(unix)]
    fn cli_start_count(helper_path: &PathBuf) -> u32 {
        std::fs::read_to_string(format!("{}.starts", helper_path.display()))
            .unwrap()
            .trim()
            .parse()
            .unwrap()
    }

    #[test]
    fn normalizes_cli_values_for_javascript() {
        let mut value = json!({"id": 9007199254740993_i64, "payload": "\\xCA\\xFE"});
        normalize_cli_value(&mut value);
        assert_eq!(
            value,
            json!({"id": "9007199254740993", "payload": "\\xCA\\xFE"})
        );
    }

    #[test]
    fn normalizes_minimum_i64_without_panicking() {
        let mut value = json!({"value": i64::MIN});

        normalize_cli_value(&mut value);

        assert_eq!(value, json!({"value": i64::MIN.to_string()}));
    }

    #[test]
    fn preserves_blob_shaped_strings_verbatim() {
        let mut value = json!({"value": "\\xCA\\xFE"});

        normalize_cli_value(&mut value);

        assert_eq!(value, json!({"value": "\\xCA\\xFE"}));
    }

    #[cfg(unix)]
    #[tokio::test]
    async fn restarts_the_cli_after_a_transport_failure() {
        let (directory, helper_path) = fake_cli();
        let driver = DuckDbDriver::with_helper_path(
            DuckDbConfig {
                file_path: directory.path().join("data.duckdb").display().to_string(),
            },
            helper_path,
        );

        let failed = driver.execute_query("BREAK_SESSION").await.unwrap();
        assert!(failed.error.is_some());

        let recovered = driver.execute_query("SELECT CHECK_SESSION").await.unwrap();
        assert!(recovered.error.is_none());
        assert_eq!(recovered.data[0]["value"], 0);
    }

    #[cfg(unix)]
    #[tokio::test]
    async fn read_only_execution_does_not_destroy_interactive_session_state() {
        let (directory, helper_path) = fake_cli();
        let driver = DuckDbDriver::with_helper_path(
            DuckDbConfig {
                file_path: directory.path().join("data.duckdb").display().to_string(),
            },
            helper_path,
        );

        let configured = driver.execute_query("SET_SESSION").await.unwrap();
        assert!(configured.error.is_none());

        let read_only = driver.execute_query_read_only("SELECT 1").await.unwrap();
        assert!(read_only
            .error
            .as_deref()
            .is_some_and(|error| error.contains("active DuckDB session")));

        let resumed = driver.execute_query("SELECT CHECK_SESSION").await.unwrap();
        assert!(resumed.error.is_none());
        assert_eq!(resumed.data[0]["value"], 1);
    }

    #[cfg(unix)]
    #[tokio::test]
    async fn health_check_reuses_the_active_cli_session() {
        let (directory, helper_path) = fake_cli();
        let driver = DuckDbDriver::with_helper_path(
            DuckDbConfig {
                file_path: directory.path().join("data.duckdb").display().to_string(),
            },
            helper_path.clone(),
        );

        let query = driver.execute_query("SELECT 1").await.unwrap();
        assert!(query.error.is_none());
        assert_eq!(cli_start_count(&helper_path), 1);

        let health = driver.test_connection().await.unwrap();

        assert!(health.success);
        assert_eq!(cli_start_count(&helper_path), 1);
    }

    #[cfg(unix)]
    #[tokio::test]
    async fn initial_health_check_leaves_the_database_available_for_read_only_access() {
        let (directory, helper_path) = fake_cli();
        let driver = DuckDbDriver::with_helper_path(
            DuckDbConfig {
                file_path: directory.path().join("data.duckdb").display().to_string(),
            },
            helper_path.clone(),
        );

        let health = driver.test_connection().await.unwrap();
        assert!(health.success);

        let read_only = driver.execute_query_read_only("SELECT 1").await.unwrap();

        assert!(read_only.error.is_none());
        assert_eq!(cli_start_count(&helper_path), 2);
    }

    #[test]
    fn renders_structured_filter_values_without_sql_injection() {
        let filter = CompiledFilter {
            sql: "\"name\" = ?".to_string(),
            values: vec![FilterValue::Text("O'Reilly".to_string())],
        };
        assert_eq!(
            render_filter(" WHERE \"name\" = ?", &filter).unwrap(),
            " WHERE \"name\" = 'O''Reilly'"
        );
    }
}
