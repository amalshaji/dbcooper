use async_trait::async_trait;
use reqwest::{Client, StatusCode, Url};
use serde::de::DeserializeOwned;
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use std::time::Instant;

use super::create_table::build_sqlite_create_table_sql;
use super::filter::{
    build_where_clause, classify_column_type, compile_filter, structured_expression, FilterDialect,
    FilterValue,
};
use super::queries::sqlite::TABLES_QUERY;
use super::{DatabaseDriver, MAX_QUERY_RESULT_ROWS};
use crate::db::models::{
    ColumnInfo, CreateTableRequest, ForeignKeyInfo, IndexInfo, QueryResult, SchemaOverview,
    TableDataResponse, TableFilter, TableInfo, TableStructure, TableWithStructure,
    TestConnectionResult,
};

const CLOUDFLARE_API_BASE_URL: &str = "https://api.cloudflare.com/client/v4";

#[derive(Clone)]
pub struct D1Config {
    pub account_id: String,
    pub database_id: String,
    pub api_token: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct D1Database {
    pub uuid: String,
    pub name: String,
    #[serde(default)]
    pub created_at: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct D1DatabaseList {
    pub databases: Vec<D1Database>,
    pub page: u32,
    pub total_pages: u32,
}

#[derive(Debug, Deserialize)]
struct D1ApiError {
    #[serde(default)]
    code: Option<i64>,
    message: String,
}

#[derive(Debug, Deserialize)]
struct D1QueryResponse {
    success: bool,
    #[serde(default)]
    errors: Vec<D1ApiError>,
    #[serde(default)]
    result: Vec<D1StatementResult>,
}

#[derive(Debug, Deserialize)]
struct D1StatementResult {
    success: bool,
    #[serde(default)]
    results: Vec<Value>,
    #[serde(default)]
    meta: D1QueryMeta,
    #[serde(default)]
    error: Option<String>,
}

#[derive(Debug, Default, Deserialize)]
struct D1QueryMeta {
    #[serde(default)]
    changes: u64,
}

#[derive(Debug, Deserialize)]
struct D1ListResponse {
    success: bool,
    #[serde(default)]
    errors: Vec<D1ApiError>,
    #[serde(default)]
    result: Vec<D1Database>,
    #[serde(default)]
    result_info: D1ResultInfo,
}

#[derive(Debug, Default, Deserialize)]
struct D1ResultInfo {
    #[serde(default = "default_page")]
    page: u32,
    #[serde(default = "default_page")]
    total_pages: u32,
}

fn default_page() -> u32 {
    1
}

#[derive(Serialize)]
struct D1QueryRequest<'a> {
    sql: &'a str,
    #[serde(skip_serializing_if = "Vec::is_empty")]
    params: Vec<Value>,
}

pub struct D1Driver {
    config: D1Config,
    client: Client,
    api_base_url: String,
}

impl D1Driver {
    pub fn new(config: D1Config) -> Self {
        Self {
            config,
            client: Client::new(),
            api_base_url: api_base_url(),
        }
    }

    #[cfg(test)]
    fn with_api_base_url(config: D1Config, api_base_url: String) -> Self {
        Self {
            config,
            client: Client::new(),
            api_base_url,
        }
    }

    fn query_url(&self) -> Result<Url, String> {
        d1_database_url(
            &self.api_base_url,
            self.config.account_id.trim(),
            self.config.database_id.trim(),
            Some("query"),
        )
    }

    fn validate_config(&self) -> Result<(), String> {
        if self.config.account_id.trim().is_empty() {
            return Err("Cloudflare Account ID is required".to_string());
        }
        if self.config.database_id.trim().is_empty() {
            return Err("Cloudflare D1 database ID is required".to_string());
        }
        if self.config.api_token.trim().is_empty() {
            return Err("Cloudflare API token is required".to_string());
        }
        Ok(())
    }

    async fn query(&self, sql: &str, params: Vec<Value>) -> Result<D1StatementResult, String> {
        self.validate_config()?;
        let response = self
            .client
            .post(self.query_url()?)
            .bearer_auth(self.config.api_token.trim())
            .json(&D1QueryRequest { sql, params })
            .send()
            .await
            .map_err(|error| format!("Cloudflare D1 request failed: {error}"))?;

        let (status, envelope): (_, D1QueryResponse) = read_response(response).await?;
        if !status.is_success() || !envelope.success {
            return Err(format_api_errors(&envelope.errors, status));
        }

        let statement = envelope
            .result
            .into_iter()
            .next()
            .ok_or_else(|| "Cloudflare D1 returned no query result".to_string())?;
        if !statement.success {
            return Err(statement
                .error
                .unwrap_or_else(|| "Cloudflare D1 query failed".to_string()));
        }
        Ok(statement)
    }

    fn params(values: &[FilterValue]) -> Vec<Value> {
        values
            .iter()
            .map(|value| match value {
                FilterValue::Text(value) => Value::String(value.clone()),
                FilterValue::Integer(value) => json!(value),
                FilterValue::Float(value) => json!(value),
                FilterValue::Boolean(value) => json!(value),
                FilterValue::ExactNumber { value, .. } => Value::String(value.clone()),
            })
            .collect()
    }

    async fn structure(&self, table: &str) -> Result<TableStructure, String> {
        let escaped = escape_sql_string(table);
        let columns_result = self
            .query(&format!("PRAGMA table_info('{escaped}')"), vec![])
            .await?;
        let indexes_result = self
            .query(&format!("PRAGMA index_list('{escaped}')"), vec![])
            .await?;
        let foreign_keys_result = self
            .query(&format!("PRAGMA foreign_key_list('{escaped}')"), vec![])
            .await?;

        let columns = columns_result
            .results
            .iter()
            .map(column_from_row)
            .collect::<Result<Vec<_>, _>>()?;
        let mut indexes = Vec::new();
        for row in indexes_result.results {
            let name = string_field(&row, "name")?;
            let index_columns = self
                .query(
                    &format!("PRAGMA index_info('{}')", escape_sql_string(&name)),
                    vec![],
                )
                .await?
                .results
                .iter()
                .filter_map(|row| row.get("name").and_then(Value::as_str).map(str::to_owned))
                .collect();
            indexes.push(IndexInfo {
                name,
                columns: index_columns,
                unique: integer_field(&row, "unique").unwrap_or(0) == 1,
                primary: row.get("origin").and_then(Value::as_str) == Some("pk"),
            });
        }
        let foreign_keys = foreign_keys_result
            .results
            .iter()
            .map(foreign_key_from_row)
            .collect::<Result<Vec<_>, _>>()?;

        Ok(TableStructure {
            columns,
            indexes,
            foreign_keys,
        })
    }
}

#[async_trait]
impl DatabaseDriver for D1Driver {
    fn as_any(&self) -> &dyn std::any::Any {
        self
    }

    async fn test_connection(&self) -> Result<TestConnectionResult, String> {
        match self.query("SELECT 1 AS ok", vec![]).await {
            Ok(_) => Ok(TestConnectionResult {
                success: true,
                message: "Connected to Cloudflare D1".to_string(),
            }),
            Err(message) => Ok(TestConnectionResult {
                success: false,
                message,
            }),
        }
    }

    async fn list_tables(&self) -> Result<Vec<TableInfo>, String> {
        self.query(TABLES_QUERY, vec![])
            .await?
            .results
            .iter()
            .filter(|row| {
                !row.get("name")
                    .and_then(Value::as_str)
                    .is_some_and(|name| name.starts_with("_cf_"))
            })
            .map(|row| {
                Ok(TableInfo {
                    schema: "main".to_string(),
                    name: string_field(row, "name")?,
                    table_type: string_field(row, "type")?,
                })
            })
            .collect()
    }

    fn preview_create_table(&self, request: &CreateTableRequest) -> Result<String, String> {
        build_sqlite_create_table_sql(request)
    }

    async fn create_table(&self, request: &CreateTableRequest) -> Result<TableInfo, String> {
        let sql = self.preview_create_table(request)?;
        self.query(&sql, vec![]).await?;
        Ok(TableInfo {
            schema: request.schema.clone(),
            name: request.name.clone(),
            table_type: "table".to_string(),
        })
    }

    async fn get_table_data(
        &self,
        _schema: &str,
        table: &str,
        page: i64,
        limit: i64,
        filter: Option<TableFilter>,
        sort_column: Option<String>,
        sort_direction: Option<String>,
    ) -> Result<TableDataResponse, String> {
        let structure = self.structure(table).await?;
        let compiled_filter = structured_expression(filter.as_ref())
            .map(|expression| compile_filter(expression, &structure.columns, FilterDialect::Sqlite))
            .transpose()?;
        let where_clause = build_where_clause(filter.as_ref(), compiled_filter.as_ref());
        let params = compiled_filter
            .as_ref()
            .map(|filter| Self::params(&filter.values))
            .unwrap_or_default();
        let escaped_table = table.replace('"', "\"\"");
        let count = self
            .query(
                &format!("SELECT COUNT(*) AS count FROM \"{escaped_table}\"{where_clause}"),
                params.clone(),
            )
            .await?;
        let total = count
            .results
            .first()
            .and_then(|row| integer_field(row, "count"))
            .ok_or_else(|| "Cloudflare D1 returned an invalid row count".to_string())?;
        let order_clause = if let Some(column) = sort_column {
            let direction = if sort_direction.as_deref() == Some("desc") {
                "DESC"
            } else {
                "ASC"
            };
            format!(" ORDER BY \"{}\" {direction}", column.replace('"', "\"\""))
        } else {
            let primary_keys = structure
                .columns
                .iter()
                .filter(|column| column.primary_key)
                .map(|column| format!("\"{}\" ASC", column.name.replace('"', "\"\"")))
                .collect::<Vec<_>>();
            if primary_keys.is_empty() {
                String::new()
            } else {
                format!(" ORDER BY {}", primary_keys.join(", "))
            }
        };
        let offset = (page - 1).max(0) * limit;
        let data = self
            .query(
                &format!(
                    "SELECT * FROM \"{escaped_table}\"{where_clause}{order_clause} LIMIT {limit} OFFSET {offset}"
                ),
                params,
            )
            .await?
            .results;

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
        self.structure(table).await
    }

    async fn execute_query(&self, query: &str) -> Result<QueryResult, String> {
        let start = Instant::now();
        match self.query(query, vec![]).await {
            Ok(statement) => {
                let mut result = query_result_from_statement(statement);
                result.time_taken_ms = Some(start.elapsed().as_millis());
                Ok(result)
            }
            Err(error) => Ok(QueryResult::from_error(error, start)),
        }
    }

    async fn execute_query_read_only(&self, _query: &str) -> Result<QueryResult, String> {
        Ok(QueryResult::from_error(
            "Cloudflare D1 query execution is not available through MCP yet".to_string(),
            Instant::now(),
        ))
    }

    async fn get_schema_overview(&self) -> Result<SchemaOverview, String> {
        let tables = self.list_tables().await?;
        let mut overview = Vec::with_capacity(tables.len());
        for table in tables {
            let structure = self.structure(&table.name).await?;
            overview.push(TableWithStructure {
                schema: table.schema,
                name: table.name,
                table_type: table.table_type,
                columns: structure.columns,
                foreign_keys: structure.foreign_keys,
                indexes: structure.indexes,
            });
        }
        Ok(SchemaOverview {
            tables: overview,
            functions: Vec::new(),
        })
    }
}

pub async fn list_databases(
    account_id: &str,
    api_token: &str,
    page: u32,
) -> Result<D1DatabaseList, String> {
    list_databases_at_base(&api_base_url(), account_id, api_token, page).await
}

async fn list_databases_at_base(
    api_base_url: &str,
    account_id: &str,
    api_token: &str,
    page: u32,
) -> Result<D1DatabaseList, String> {
    if account_id.trim().is_empty() || api_token.trim().is_empty() {
        return Err("Cloudflare Account ID and API token are required".to_string());
    }
    let client = Client::new();
    let mut url = d1_database_url(api_base_url, account_id.trim(), "", None)?;
    url.query_pairs_mut()
        .append_pair("page", &page.max(1).to_string())
        .append_pair("per_page", "50");
    let response = client
        .get(url)
        .bearer_auth(api_token.trim())
        .send()
        .await
        .map_err(|error| format!("Cloudflare D1 request failed: {error}"))?;
    let (status, envelope): (_, D1ListResponse) = read_response(response).await?;
    if !status.is_success() || !envelope.success {
        return Err(format_api_errors(&envelope.errors, status));
    }
    Ok(D1DatabaseList {
        databases: envelope.result,
        page: envelope.result_info.page,
        total_pages: envelope.result_info.total_pages,
    })
}

async fn read_response<T: DeserializeOwned>(
    response: reqwest::Response,
) -> Result<(StatusCode, T), String> {
    let status = response.status();
    let retry_after = response
        .headers()
        .get(reqwest::header::RETRY_AFTER)
        .and_then(|value| value.to_str().ok())
        .map(str::to_owned);
    let body = response
        .text()
        .await
        .map_err(|error| format!("Failed to read Cloudflare D1 response: {error}"))?;
    if status == StatusCode::TOO_MANY_REQUESTS {
        let suffix = retry_after
            .map(|value| format!(" Retry after {value} seconds."))
            .unwrap_or_default();
        return Err(format!("Cloudflare API rate limit exceeded.{suffix}"));
    }
    let envelope = serde_json::from_str(&body).map_err(|error| {
        format!("Cloudflare D1 returned an invalid response ({status}): {error}")
    })?;
    Ok((status, envelope))
}

fn api_base_url() -> String {
    #[cfg(debug_assertions)]
    if let Ok(value) = std::env::var("DBCOOPER_D1_API_BASE_URL") {
        if !value.trim().is_empty() {
            return value;
        }
    }
    CLOUDFLARE_API_BASE_URL.to_string()
}

fn d1_database_url(
    base_url: &str,
    account_id: &str,
    database_id: &str,
    suffix: Option<&str>,
) -> Result<Url, String> {
    let mut url = Url::parse(&format!("{}/", base_url.trim_end_matches('/')))
        .map_err(|error| format!("Invalid Cloudflare API URL: {error}"))?;
    {
        let mut segments = url
            .path_segments_mut()
            .map_err(|_| "Invalid Cloudflare API URL".to_string())?;
        segments.pop_if_empty();
        segments.extend(["accounts", account_id, "d1", "database"]);
        if !database_id.is_empty() {
            segments.push(database_id);
        }
        if let Some(suffix) = suffix {
            segments.push(suffix);
        }
    }
    Ok(url)
}

fn format_api_errors(errors: &[D1ApiError], status: StatusCode) -> String {
    errors.first().map_or_else(
        || format!("Cloudflare D1 API request failed with status {status}"),
        |error| match error.code {
            Some(code) => format!("Cloudflare D1 API error {code}: {}", error.message),
            None => format!("Cloudflare D1 API error: {}", error.message),
        },
    )
}

#[cfg(test)]
fn parse_query_response(response: D1QueryResponse) -> Result<QueryResult, String> {
    if !response.success {
        return Err(format_api_errors(&response.errors, StatusCode::BAD_REQUEST));
    }
    let statement = response
        .result
        .into_iter()
        .next()
        .ok_or_else(|| "Cloudflare D1 returned no query result".to_string())?;
    if !statement.success {
        return Err(statement
            .error
            .unwrap_or_else(|| "Cloudflare D1 query failed".to_string()));
    }
    Ok(query_result_from_statement(statement))
}

fn query_result_from_statement(statement: D1StatementResult) -> QueryResult {
    let truncated = statement.results.len() > MAX_QUERY_RESULT_ROWS;
    let data = statement
        .results
        .into_iter()
        .take(MAX_QUERY_RESULT_ROWS)
        .collect::<Vec<_>>();
    QueryResult {
        row_count: data.len() as i64,
        data,
        truncated,
        rows_affected: Some(statement.meta.changes),
        error: None,
        time_taken_ms: None,
    }
}

fn string_field(row: &Value, field: &str) -> Result<String, String> {
    row.get(field)
        .and_then(Value::as_str)
        .map(str::to_owned)
        .ok_or_else(|| format!("Cloudflare D1 response is missing {field}"))
}

fn integer_field(row: &Value, field: &str) -> Option<i64> {
    row.get(field).and_then(|value| {
        value
            .as_i64()
            .or_else(|| value.as_u64().and_then(|value| i64::try_from(value).ok()))
            .or_else(|| value.as_str().and_then(|value| value.parse().ok()))
    })
}

fn column_from_row(row: &Value) -> Result<ColumnInfo, String> {
    let data_type = row
        .get("type")
        .and_then(Value::as_str)
        .unwrap_or_default()
        .to_ascii_uppercase();
    Ok(ColumnInfo {
        name: string_field(row, "name")?,
        filter_kind: classify_column_type(&data_type, FilterDialect::Sqlite),
        data_type,
        nullable: integer_field(row, "notnull").unwrap_or(0) == 0,
        default: row
            .get("dflt_value")
            .and_then(Value::as_str)
            .map(str::to_owned),
        primary_key: integer_field(row, "pk").unwrap_or(0) > 0,
    })
}

fn foreign_key_from_row(row: &Value) -> Result<ForeignKeyInfo, String> {
    Ok(ForeignKeyInfo {
        name: format!("fk_{}", integer_field(row, "id").unwrap_or(0)),
        column: string_field(row, "from")?,
        references_table: string_field(row, "table")?,
        references_column: string_field(row, "to")?,
    })
}

fn escape_sql_string(value: &str) -> String {
    value.replace('\'', "''")
}

#[cfg(test)]
mod tests {
    use super::{
        d1_database_url, list_databases_at_base, parse_query_response, D1Config, D1Driver,
        D1QueryResponse,
    };
    use crate::database::DatabaseDriver;
    use axum::extract::State;
    use axum::http::{header::RETRY_AFTER, HeaderMap, StatusCode, Uri};
    use axum::routing::{get, post};
    use axum::{Json, Router};
    use serde_json::json;
    use tokio::net::TcpListener;
    use tokio::sync::mpsc;

    #[test]
    fn parses_cloudflare_query_results_and_change_metadata() {
        let response: D1QueryResponse = serde_json::from_value(json!({
            "success": true,
            "errors": [],
            "messages": [],
            "result": [{
                "success": true,
                "results": [{"id": 1, "name": "Ada"}],
                "meta": {"changes": 1, "duration": 0.42}
            }]
        }))
        .unwrap();

        let result = parse_query_response(response).unwrap();

        assert_eq!(result.data, vec![json!({"id": 1, "name": "Ada"})]);
        assert_eq!(result.rows_affected, Some(1));
        assert!(result.error.is_none());
    }

    #[test]
    fn reports_cloudflare_envelope_errors_without_exposing_credentials() {
        let response: D1QueryResponse = serde_json::from_value(json!({
            "success": false,
            "errors": [{"code": 7500, "message": "Authentication error"}],
            "messages": [],
            "result": []
        }))
        .unwrap();

        let error = parse_query_response(response).unwrap_err();

        assert_eq!(error, "Cloudflare D1 API error 7500: Authentication error");
    }

    #[test]
    fn percent_encodes_identifiers_in_api_urls() {
        let url = d1_database_url(
            "https://api.cloudflare.com/client/v4",
            "account/one",
            "database two",
            Some("query"),
        )
        .unwrap();

        assert_eq!(
            url.as_str(),
            "https://api.cloudflare.com/client/v4/accounts/account%2Fone/d1/database/database%20two/query"
        );
    }

    #[tokio::test]
    async fn sends_the_documented_bearer_query_contract() {
        let (sender, mut receiver) = mpsc::unbounded_channel();
        let app = Router::new()
            .route(
                "/client/v4/accounts/account-id/d1/database/database-id/query",
                post(
                    |State(sender): State<
                        mpsc::UnboundedSender<(HeaderMap, serde_json::Value)>,
                    >,
                     headers: HeaderMap,
                     Json(body): Json<serde_json::Value>| async move {
                        sender.send((headers, body)).unwrap();
                        Json(json!({
                            "success": true,
                            "errors": [],
                            "messages": [],
                            "result": [{
                                "success": true,
                                "results": [{"ok": 1}],
                                "meta": {"changes": 0}
                            }]
                        }))
                    },
                ),
            )
            .with_state(sender);
        let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
        let address = listener.local_addr().unwrap();
        let server = tokio::spawn(async move { axum::serve(listener, app).await.unwrap() });
        let driver = D1Driver::with_api_base_url(
            D1Config {
                account_id: " account-id ".to_string(),
                database_id: "database-id".to_string(),
                api_token: " secret-token\n".to_string(),
            },
            format!("http://{address}/client/v4"),
        );

        let result = driver.query("SELECT 1 AS ok", vec![]).await.unwrap();
        let (headers, body) = receiver.recv().await.unwrap();
        server.abort();

        assert_eq!(result.results, vec![json!({"ok": 1})]);
        assert_eq!(headers.get("authorization").unwrap(), "Bearer secret-token");
        assert_eq!(body, json!({"sql": "SELECT 1 AS ok"}));
    }

    #[tokio::test]
    async fn reports_non_json_query_rate_limits() {
        let app = Router::new().route(
            "/client/v4/accounts/account-id/d1/database/database-id/query",
            post(|| async {
                (
                    StatusCode::TOO_MANY_REQUESTS,
                    [(RETRY_AFTER, "7")],
                    "slow down",
                )
            }),
        );
        let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
        let address = listener.local_addr().unwrap();
        let server = tokio::spawn(async move { axum::serve(listener, app).await.unwrap() });
        let driver = D1Driver::with_api_base_url(
            D1Config {
                account_id: "account-id".to_string(),
                database_id: "database-id".to_string(),
                api_token: "secret-token".to_string(),
            },
            format!("http://{address}/client/v4"),
        );

        let error = driver.query("SELECT 1", vec![]).await.unwrap_err();
        server.abort();

        assert_eq!(
            error,
            "Cloudflare API rate limit exceeded. Retry after 7 seconds."
        );
    }

    #[tokio::test]
    async fn lists_databases_with_explicit_pagination() {
        let (sender, mut receiver) = mpsc::unbounded_channel();
        let app = Router::new()
            .route(
                "/client/v4/accounts/account-id/d1/database",
                get(
                    |State(sender): State<mpsc::UnboundedSender<(HeaderMap, Uri)>>,
                     headers: HeaderMap,
                     uri: Uri| async move {
                        sender.send((headers, uri)).unwrap();
                        Json(json!({
                            "success": true,
                            "errors": [],
                            "messages": [],
                            "result": [{"uuid": "database-id", "name": "Production"}],
                            "result_info": {"page": 2, "total_pages": 3}
                        }))
                    },
                ),
            )
            .with_state(sender);
        let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
        let address = listener.local_addr().unwrap();
        let server = tokio::spawn(async move { axum::serve(listener, app).await.unwrap() });

        let result = list_databases_at_base(
            &format!("http://{address}/client/v4"),
            " account-id ",
            " secret-token\n",
            2,
        )
        .await
        .unwrap();
        let (headers, uri) = receiver.recv().await.unwrap();
        server.abort();

        assert_eq!(result.page, 2);
        assert_eq!(result.total_pages, 3);
        assert_eq!(result.databases[0].uuid, "database-id");
        assert_eq!(headers.get("authorization").unwrap(), "Bearer secret-token");
        assert_eq!(uri.query(), Some("page=2&per_page=50"));
    }

    #[tokio::test]
    async fn reports_non_json_database_list_rate_limits() {
        let app = Router::new().route(
            "/client/v4/accounts/account-id/d1/database",
            get(|| async {
                (
                    StatusCode::TOO_MANY_REQUESTS,
                    [(RETRY_AFTER, "11")],
                    "slow down",
                )
            }),
        );
        let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
        let address = listener.local_addr().unwrap();
        let server = tokio::spawn(async move { axum::serve(listener, app).await.unwrap() });

        let error = list_databases_at_base(
            &format!("http://{address}/client/v4"),
            "account-id",
            "secret-token",
            1,
        )
        .await
        .unwrap_err();
        server.abort();

        assert_eq!(
            error,
            "Cloudflare API rate limit exceeded. Retry after 11 seconds."
        );
    }

    #[tokio::test]
    async fn hides_cloudflare_managed_tables_from_schema_browsing() {
        let app = Router::new().route(
            "/client/v4/accounts/account-id/d1/database/database-id/query",
            post(|| async {
                Json(json!({
                    "success": true,
                    "errors": [],
                    "messages": [],
                    "result": [{
                        "success": true,
                        "results": [
                            {"name": "_cf_KV", "type": "table"},
                            {"name": "d1_migrations", "type": "table"},
                            {"name": "uploads", "type": "table"}
                        ],
                        "meta": {"changes": 0}
                    }]
                }))
            }),
        );
        let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
        let address = listener.local_addr().unwrap();
        let server = tokio::spawn(async move { axum::serve(listener, app).await.unwrap() });
        let driver = D1Driver::with_api_base_url(
            D1Config {
                account_id: "account-id".to_string(),
                database_id: "database-id".to_string(),
                api_token: "secret-token".to_string(),
            },
            format!("http://{address}/client/v4"),
        );

        let tables = driver.list_tables().await.unwrap();
        server.abort();

        assert_eq!(
            tables
                .into_iter()
                .map(|table| table.name)
                .collect::<Vec<_>>(),
            vec!["d1_migrations", "uploads"]
        );
    }

    #[tokio::test]
    #[ignore = "run with bun run test:d1-local"]
    async fn local_wrangler_supports_schema_browsing_and_crud() {
        let api_base_url = std::env::var("DBCOOPER_D1_LOCAL_URL")
            .expect("DBCOOPER_D1_LOCAL_URL is set by scripts/test-d1-local.sh");
        let driver = D1Driver::with_api_base_url(
            D1Config {
                account_id: "local-account".to_string(),
                database_id: "local-database".to_string(),
                api_token: "local-token".to_string(),
            },
            api_base_url,
        );

        for sql in [
            "DROP TABLE IF EXISTS d1_people",
            "CREATE TABLE d1_people (id INTEGER PRIMARY KEY, name TEXT NOT NULL)",
            "INSERT INTO d1_people (id, name) VALUES (1, 'Ada')",
        ] {
            let result = driver.execute_query(sql).await.unwrap();
            assert!(result.error.is_none(), "{sql}: {:?}", result.error);
        }

        let tables = driver.list_tables().await.unwrap();
        let structure = driver
            .get_table_structure("main", "d1_people")
            .await
            .unwrap();
        let data = driver
            .get_table_data("main", "d1_people", 1, 20, None, None, None)
            .await
            .unwrap();

        assert!(tables.iter().any(|table| table.name == "d1_people"));
        assert!(structure
            .columns
            .iter()
            .any(|column| column.name == "id" && column.primary_key));
        assert_eq!(data.total, 1);
        assert_eq!(data.data, vec![json!({"id": 1, "name": "Ada"})]);
    }
}
