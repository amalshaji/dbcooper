use serde::{Deserialize, Serialize};
use sqlx::FromRow;

#[derive(Debug, Clone, Serialize, Deserialize, FromRow)]
pub struct Connection {
    pub id: i64,
    pub uuid: String,
    #[sqlx(rename = "type")]
    #[serde(rename = "type")]
    pub connection_type: String,
    pub name: String,
    pub host: String,
    pub port: i64,
    pub database: String,
    pub username: String,
    pub password: String,
    pub ssl: i64,
    pub db_type: String,
    pub file_path: Option<String>,
    pub ssh_enabled: i64,
    pub ssh_host: String,
    pub ssh_port: i64,
    pub ssh_user: String,
    pub ssh_password: String,
    pub ssh_key_path: String,
    pub ssh_use_key: i64,
    pub created_at: String,
    pub updated_at: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ConnectionFormData {
    #[serde(rename = "type")]
    pub connection_type: String,
    pub name: String,
    pub host: String,
    pub port: i64,
    pub database: String,
    pub username: String,
    pub password: String,
    pub ssl: bool,
    #[serde(default = "default_db_type")]
    pub db_type: String,
    #[serde(default)]
    pub file_path: Option<String>,
    #[serde(default)]
    pub ssh_enabled: bool,
    #[serde(default)]
    pub ssh_host: String,
    #[serde(default = "default_ssh_port")]
    pub ssh_port: i64,
    #[serde(default)]
    pub ssh_user: String,
    #[serde(default)]
    pub ssh_password: String,
    #[serde(default)]
    pub ssh_key_path: String,
    #[serde(default)]
    pub ssh_use_key: bool,
}

fn default_db_type() -> String {
    "postgres".to_string()
}

fn default_ssh_port() -> i64 {
    22
}

#[derive(Debug, Clone, Serialize, Deserialize, FromRow)]
pub struct SavedQuery {
    pub id: i64,
    pub connection_uuid: String,
    pub name: String,
    pub query: String,
    pub created_at: String,
    pub updated_at: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SavedQueryFormData {
    pub name: String,
    pub query: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, FromRow)]
pub struct QueryHistory {
    pub id: i64,
    pub connection_uuid: String,
    pub query: String,
    pub status: String,
    pub time_taken_ms: Option<i64>,
    pub row_count: Option<i64>,
    pub rows_affected: Option<i64>,
    pub error: Option<String>,
    pub executed_at: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TableInfo {
    pub schema: String,
    pub name: String,
    #[serde(rename = "type")]
    pub table_type: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ColumnInfo {
    pub name: String,
    #[serde(rename = "type")]
    pub data_type: String,
    #[serde(default)]
    pub filter_kind: FilterColumnKind,
    pub nullable: bool,
    pub default: Option<String>,
    pub primary_key: bool,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum FilterColumnKind {
    Text,
    Integer,
    Decimal,
    Boolean,
    Temporal,
    Uuid,
    Other,
}

impl Default for FilterColumnKind {
    fn default() -> Self {
        Self::Other
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn column_info_accepts_internal_schema_json_without_filter_kind() {
        let column: ColumnInfo = serde_json::from_value(json!({
            "name": "id",
            "type": "bigint",
            "nullable": false,
            "default": null,
            "primary_key": true
        }))
        .unwrap();

        assert_eq!(column.filter_kind, FilterColumnKind::Other);
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct IndexInfo {
    pub name: String,
    pub columns: Vec<String>,
    pub unique: bool,
    pub primary: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ForeignKeyInfo {
    pub name: String,
    pub column: String,
    pub references_table: String,
    pub references_column: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TableStructure {
    pub columns: Vec<ColumnInfo>,
    pub indexes: Vec<IndexInfo>,
    pub foreign_keys: Vec<ForeignKeyInfo>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TableDataResponse {
    pub data: Vec<serde_json::Value>,
    pub total: i64,
    pub page: i64,
    pub limit: i64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum FilterConjunction {
    And,
    Or,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum FilterOperator {
    Equals,
    NotEquals,
    Contains,
    StartsWith,
    EndsWith,
    GreaterThan,
    GreaterThanOrEqual,
    LessThan,
    LessThanOrEqual,
    In,
    IsNull,
    IsNotNull,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct FilterCondition {
    pub column: String,
    pub operator: FilterOperator,
    pub value: Option<serde_json::Value>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct FilterExpression {
    pub conjunction: FilterConjunction,
    pub conditions: Vec<FilterCondition>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(tag = "kind", content = "value", rename_all = "snake_case")]
pub enum TableFilter {
    Advanced(String),
    Structured(FilterExpression),
}

impl TableFilter {
    pub fn from_parts(
        advanced: Option<String>,
        structured: Option<FilterExpression>,
    ) -> Result<Option<Self>, String> {
        match (
            advanced.filter(|value| !value.trim().is_empty()),
            structured,
        ) {
            (Some(_), Some(_)) => {
                Err("Choose either structured filters or an advanced WHERE clause".to_string())
            }
            (Some(value), None) => Ok(Some(Self::Advanced(value))),
            (None, Some(value)) => Ok(Some(Self::Structured(value))),
            (None, None) => Ok(None),
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct QueryResult {
    pub data: Vec<serde_json::Value>,
    pub row_count: i64,
    pub truncated: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub rows_affected: Option<u64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub error: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub time_taken_ms: Option<u128>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TestConnectionResult {
    pub success: bool,
    pub message: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, FromRow)]
pub struct Setting {
    pub key: String,
    pub value: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TableWithStructure {
    pub schema: String,
    pub name: String,
    #[serde(rename = "type")]
    pub table_type: String,
    pub columns: Vec<ColumnInfo>,
    pub foreign_keys: Vec<ForeignKeyInfo>,
    pub indexes: Vec<IndexInfo>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct FunctionSummary {
    pub schema: String,
    pub name: String,
    pub identity_args: String,
    pub arguments: String,
    pub return_type: String,
    pub language: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct FunctionDefinition {
    pub schema: String,
    pub name: String,
    pub identity_args: String,
    pub arguments: String,
    pub return_type: String,
    pub language: String,
    pub definition: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SchemaOverview {
    pub tables: Vec<TableWithStructure>,
    pub functions: Vec<FunctionSummary>,
}
