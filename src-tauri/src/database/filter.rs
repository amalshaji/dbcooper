use crate::db::models::{
    ColumnInfo, FilterColumnKind, FilterConjunction, FilterExpression, FilterOperator, TableFilter,
};
use serde_json::Value;

const MAX_CONDITIONS: usize = 20;
const MAX_IN_VALUES: usize = 100;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum FilterDialect {
    Postgres,
    Sqlite,
    Clickhouse,
}

fn normalize_clickhouse_type(data_type: &str) -> String {
    let mut normalized = data_type.trim().to_string();

    loop {
        let lower = normalized.to_ascii_lowercase();
        let wrapper = ["nullable", "lowcardinality"]
            .into_iter()
            .find(|wrapper| lower.starts_with(&format!("{wrapper}(")));
        let Some(wrapper) = wrapper else {
            break;
        };
        let prefix_len = wrapper.len() + 1;
        if !normalized.ends_with(')') {
            break;
        }
        normalized = normalized[prefix_len..normalized.len() - 1]
            .trim()
            .to_string();
    }

    normalized
}

pub fn classify_column_type(data_type: &str, dialect: FilterDialect) -> FilterColumnKind {
    let normalized = data_type.trim().to_ascii_lowercase();

    match dialect {
        FilterDialect::Postgres => match normalized.as_str() {
            "smallint" | "integer" | "bigint" | "smallserial" | "serial" | "bigserial" => {
                FilterColumnKind::Integer
            }
            "numeric" | "decimal" | "real" | "double precision" | "money" => {
                FilterColumnKind::Decimal
            }
            "boolean" => FilterColumnKind::Boolean,
            "date"
            | "time"
            | "time without time zone"
            | "time with time zone"
            | "timestamp"
            | "timestamp without time zone"
            | "timestamp with time zone"
            | "interval" => FilterColumnKind::Temporal,
            "uuid" => FilterColumnKind::Uuid,
            "text" | "character" | "character varying" | "citext" | "name" => {
                FilterColumnKind::Text
            }
            _ => FilterColumnKind::Other,
        },
        FilterDialect::Sqlite => {
            if normalized == "boolean" || normalized == "bool" {
                return FilterColumnKind::Boolean;
            }
            if normalized.contains("date") || normalized.contains("time") {
                return FilterColumnKind::Temporal;
            }

            let declared_type = normalized.to_ascii_uppercase();
            if declared_type.contains("INT") {
                FilterColumnKind::Integer
            } else if ["CHAR", "CLOB", "TEXT"]
                .iter()
                .any(|token| declared_type.contains(token))
            {
                FilterColumnKind::Text
            } else if declared_type.is_empty() || declared_type.contains("BLOB") {
                FilterColumnKind::Other
            } else {
                FilterColumnKind::Decimal
            }
        }
        FilterDialect::Clickhouse => {
            let base_type = normalize_clickhouse_type(data_type).to_ascii_lowercase();
            if base_type == "string" || base_type.starts_with("fixedstring(") {
                FilterColumnKind::Text
            } else if base_type == "bool" || base_type == "boolean" {
                FilterColumnKind::Boolean
            } else if base_type == "uuid" {
                FilterColumnKind::Uuid
            } else if ["date", "date32", "time", "time64", "datetime", "datetime64"]
                .iter()
                .any(|name| base_type == *name || base_type.starts_with(&format!("{name}(")))
            {
                FilterColumnKind::Temporal
            } else if base_type.starts_with("int") || base_type.starts_with("uint") {
                FilterColumnKind::Integer
            } else if base_type.starts_with("float") || base_type.starts_with("decimal") {
                FilterColumnKind::Decimal
            } else {
                FilterColumnKind::Other
            }
        }
    }
}

#[derive(Debug, Clone, PartialEq)]
pub enum FilterValue {
    Text(String),
    Integer(i64),
    Float(f64),
    Boolean(bool),
    ExactNumber { value: String, data_type: String },
}

#[derive(Debug, Clone, PartialEq)]
pub struct CompiledFilter {
    pub sql: String,
    pub values: Vec<FilterValue>,
}

pub fn structured_expression(filter: Option<&TableFilter>) -> Option<&FilterExpression> {
    match filter {
        Some(TableFilter::Structured(expression)) => Some(expression),
        _ => None,
    }
}

pub fn build_where_clause(
    filter: Option<&TableFilter>,
    compiled: Option<&CompiledFilter>,
) -> String {
    match filter {
        Some(TableFilter::Structured(_)) => compiled
            .filter(|compiled| !compiled.sql.is_empty())
            .map(|compiled| format!(" WHERE {}", compiled.sql))
            .unwrap_or_default(),
        Some(TableFilter::Advanced(value)) => {
            format!(" WHERE {}", normalize_advanced_filter(value))
        }
        None => String::new(),
    }
}

fn normalize_advanced_filter(filter: &str) -> String {
    filter
        .replace('\u{2018}', "'")
        .replace('\u{2019}', "'")
        .replace('\u{201C}', "\"")
        .replace('\u{201D}', "\"")
        .replace("\\'", "'")
}

pub fn compile_filter(
    expression: &FilterExpression,
    columns: &[ColumnInfo],
    dialect: FilterDialect,
) -> Result<CompiledFilter, String> {
    if expression.conditions.len() > MAX_CONDITIONS {
        return Err(format!(
            "Filters are limited to {MAX_CONDITIONS} conditions"
        ));
    }

    let mut values = Vec::new();
    let mut clauses = Vec::with_capacity(expression.conditions.len());

    for condition in &expression.conditions {
        let column_info = columns
            .iter()
            .find(|column| column.name == condition.column)
            .ok_or_else(|| format!("Unknown filter column: {}", condition.column))?;

        let column = quote_identifier(&condition.column, dialect);
        let clause = match condition.operator {
            FilterOperator::IsNull => format!("{column} IS NULL"),
            FilterOperator::IsNotNull => format!("{column} IS NOT NULL"),
            FilterOperator::In => {
                let array = condition
                    .value
                    .as_ref()
                    .and_then(Value::as_array)
                    .ok_or_else(|| "The in operator requires a list of values".to_string())?;
                if array.is_empty() {
                    return Err("The in operator requires at least one value".to_string());
                }
                if array.len() > MAX_IN_VALUES {
                    return Err(format!("In filters are limited to {MAX_IN_VALUES} values"));
                }

                let mut placeholders = Vec::with_capacity(array.len());
                for item in array {
                    let value = parse_value(item, column_info, dialect)?;
                    placeholders.push(placeholder(values.len(), &value, dialect));
                    values.push(value);
                }
                format!("{column} IN ({})", placeholders.join(", "))
            }
            _ => {
                let raw_value = condition
                    .value
                    .as_ref()
                    .ok_or_else(|| "This filter requires a value".to_string())?;
                let mut value = parse_value(raw_value, column_info, dialect)?;
                let operator = match condition.operator {
                    FilterOperator::Equals => "=",
                    FilterOperator::NotEquals => "<>",
                    FilterOperator::Contains => {
                        value = with_text_pattern(value, |value| format!("%{value}%"))?;
                        "LIKE"
                    }
                    FilterOperator::StartsWith => {
                        value = with_text_pattern(value, |value| format!("{value}%"))?;
                        "LIKE"
                    }
                    FilterOperator::EndsWith => {
                        value = with_text_pattern(value, |value| format!("%{value}"))?;
                        "LIKE"
                    }
                    FilterOperator::GreaterThan => ">",
                    FilterOperator::GreaterThanOrEqual => ">=",
                    FilterOperator::LessThan => "<",
                    FilterOperator::LessThanOrEqual => "<=",
                    FilterOperator::In | FilterOperator::IsNull | FilterOperator::IsNotNull => {
                        unreachable!()
                    }
                };
                let parameter = placeholder(values.len(), &value, dialect);
                values.push(value);
                format!("{column} {operator} {parameter}")
            }
        };

        clauses.push(clause);
    }

    let separator = match expression.conjunction {
        FilterConjunction::And => " AND ",
        FilterConjunction::Or => " OR ",
    };

    Ok(CompiledFilter {
        sql: clauses.join(separator),
        values,
    })
}

fn quote_identifier(identifier: &str, dialect: FilterDialect) -> String {
    match dialect {
        FilterDialect::Postgres | FilterDialect::Sqlite => {
            format!("\"{}\"", identifier.replace('"', "\"\""))
        }
        FilterDialect::Clickhouse => format!("`{}`", identifier.replace('`', "``")),
    }
}

fn tagged_number(
    value: &Value,
    column: &ColumnInfo,
    dialect: FilterDialect,
) -> Result<Option<FilterValue>, String> {
    let Value::Object(object) = value else {
        return Ok(None);
    };
    let Some(kind) = object.get("kind").and_then(Value::as_str) else {
        return Ok(None);
    };
    if kind != "integer" && kind != "decimal" {
        return Ok(None);
    }

    let value = object
        .get("value")
        .and_then(Value::as_str)
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .ok_or_else(|| "Numeric filter value must be a non-empty string".to_string())?;
    let expected_kind = if kind == "integer" {
        FilterColumnKind::Integer
    } else {
        FilterColumnKind::Decimal
    };
    if column.filter_kind != expected_kind {
        return Err(format!(
            "Numeric filter value does not match column type: {}",
            column.name
        ));
    }

    let parsed = match (dialect, expected_kind) {
        (FilterDialect::Postgres | FilterDialect::Sqlite, FilterColumnKind::Integer) => value
            .parse::<i64>()
            .map(FilterValue::Integer)
            .map_err(|_| "Integer filter value is out of range".to_string())?,
        (FilterDialect::Postgres | FilterDialect::Sqlite, FilterColumnKind::Decimal) => {
            FilterValue::ExactNumber {
                value: value.to_string(),
                data_type: "numeric".to_string(),
            }
        }
        (FilterDialect::Clickhouse, _) => {
            let data_type = normalize_clickhouse_type(&column.data_type);
            if !data_type.chars().all(|character| {
                character.is_ascii_alphanumeric()
                    || matches!(character, '(' | ')' | ',' | ' ' | '_')
            }) {
                return Err("Unsupported ClickHouse numeric column type".to_string());
            }
            FilterValue::ExactNumber {
                value: value.to_string(),
                data_type,
            }
        }
        _ => unreachable!(),
    };

    Ok(Some(parsed))
}

fn parse_value(
    value: &Value,
    column: &ColumnInfo,
    dialect: FilterDialect,
) -> Result<FilterValue, String> {
    if let Some(value) = tagged_number(value, column, dialect)? {
        return Ok(value);
    }

    match value {
        Value::String(value) => Ok(FilterValue::Text(value.clone())),
        Value::Number(value) if value.is_i64() => Ok(FilterValue::Integer(value.as_i64().unwrap())),
        Value::Number(value) if value.is_u64() => value
            .as_u64()
            .and_then(|value| i64::try_from(value).ok())
            .map(FilterValue::Integer)
            .ok_or_else(|| "Integer filter value is out of range".to_string()),
        Value::Number(value) => value
            .as_f64()
            .map(FilterValue::Float)
            .ok_or_else(|| "Invalid numeric filter value".to_string()),
        Value::Bool(value) => Ok(FilterValue::Boolean(*value)),
        _ => Err("Filter values must be strings, numbers, or booleans".to_string()),
    }
}

fn with_text_pattern(
    value: FilterValue,
    pattern: impl FnOnce(String) -> String,
) -> Result<FilterValue, String> {
    match value {
        FilterValue::Text(value) => Ok(FilterValue::Text(pattern(value))),
        _ => Err("Text matching operators require a string value".to_string()),
    }
}

fn placeholder(index: usize, value: &FilterValue, dialect: FilterDialect) -> String {
    match dialect {
        FilterDialect::Postgres => match value {
            FilterValue::ExactNumber { data_type, .. } => {
                format!("${}::text::{data_type}", index + 1)
            }
            _ => format!("${}", index + 1),
        },
        FilterDialect::Sqlite => "?".to_string(),
        FilterDialect::Clickhouse => {
            let value_type = match value {
                FilterValue::Text(_) => "String",
                FilterValue::Integer(_) => "Int64",
                FilterValue::Float(_) => "Float64",
                FilterValue::Boolean(_) => "UInt8",
                FilterValue::ExactNumber { data_type, .. } => data_type,
            };
            format!("{{f{index}:{value_type}}}")
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::db::models::{
        ColumnInfo, FilterColumnKind, FilterCondition, FilterConjunction, FilterExpression,
        FilterOperator,
    };
    use serde_json::json;

    fn expression(condition: FilterCondition) -> FilterExpression {
        FilterExpression {
            conjunction: FilterConjunction::And,
            conditions: vec![condition],
        }
    }

    fn column(name: &str, data_type: &str, dialect: FilterDialect) -> ColumnInfo {
        ColumnInfo {
            name: name.to_string(),
            data_type: data_type.to_string(),
            filter_kind: classify_column_type(data_type, dialect),
            nullable: false,
            default: None,
            primary_key: false,
        }
    }

    #[test]
    fn classifies_column_types_by_database_dialect() {
        assert_eq!(
            classify_column_type("STRING", FilterDialect::Sqlite),
            FilterColumnKind::Decimal
        );
        assert_eq!(
            classify_column_type("FLOATING POINT", FilterDialect::Sqlite),
            FilterColumnKind::Integer
        );
        assert_eq!(
            classify_column_type("String", FilterDialect::Clickhouse),
            FilterColumnKind::Text
        );
        assert_eq!(
            classify_column_type("Nullable(UInt128)", FilterDialect::Clickhouse),
            FilterColumnKind::Integer
        );
        assert_eq!(
            classify_column_type("Decimal(38, 18)", FilterDialect::Clickhouse),
            FilterColumnKind::Decimal
        );
        assert_eq!(
            classify_column_type("timestamp with time zone", FilterDialect::Postgres),
            FilterColumnKind::Temporal
        );
    }

    #[test]
    fn compiles_postgres_values_as_parameters() {
        let compiled = compile_filter(
            &expression(FilterCondition {
                column: "status".to_string(),
                operator: FilterOperator::Equals,
                value: Some(json!("active")),
            }),
            &[column("status", "text", FilterDialect::Postgres)],
            FilterDialect::Postgres,
        )
        .unwrap();

        assert_eq!(compiled.sql, "\"status\" = $1");
        assert_eq!(
            compiled.values,
            vec![FilterValue::Text("active".to_string())]
        );
    }

    #[test]
    fn compiles_contains_with_a_bound_pattern() {
        let compiled = compile_filter(
            &expression(FilterCondition {
                column: "name".to_string(),
                operator: FilterOperator::Contains,
                value: Some(json!("cooper")),
            }),
            &[column("name", "TEXT", FilterDialect::Sqlite)],
            FilterDialect::Sqlite,
        )
        .unwrap();

        assert_eq!(compiled.sql, "\"name\" LIKE ?");
        assert_eq!(
            compiled.values,
            vec![FilterValue::Text("%cooper%".to_string())]
        );
    }

    #[test]
    fn compiles_null_checks_without_values() {
        let compiled = compile_filter(
            &expression(FilterCondition {
                column: "deleted_at".to_string(),
                operator: FilterOperator::IsNull,
                value: None,
            }),
            &[column(
                "deleted_at",
                "timestamp with time zone",
                FilterDialect::Postgres,
            )],
            FilterDialect::Postgres,
        )
        .unwrap();

        assert_eq!(compiled.sql, "\"deleted_at\" IS NULL");
        assert!(compiled.values.is_empty());
    }

    #[test]
    fn rejects_columns_outside_the_result_shape() {
        let error = compile_filter(
            &expression(FilterCondition {
                column: "password".to_string(),
                operator: FilterOperator::Equals,
                value: Some(json!("secret")),
            }),
            &[column("email", "text", FilterDialect::Postgres)],
            FilterDialect::Postgres,
        )
        .unwrap_err();

        assert_eq!(error, "Unknown filter column: password");
    }

    #[test]
    fn preserves_tagged_64_bit_integer_values() {
        let compiled = compile_filter(
            &expression(FilterCondition {
                column: "external_id".to_string(),
                operator: FilterOperator::Equals,
                value: Some(json!({
                    "kind": "integer",
                    "value": "9007199254740993"
                })),
            }),
            &[column("external_id", "bigint", FilterDialect::Postgres)],
            FilterDialect::Postgres,
        )
        .unwrap();

        assert_eq!(
            compiled.values,
            vec![FilterValue::Integer(9_007_199_254_740_993)]
        );
    }

    #[test]
    fn preserves_wide_clickhouse_integer_values() {
        let value = "340282366920938463463374607431768211455";
        let compiled = compile_filter(
            &expression(FilterCondition {
                column: "visits".to_string(),
                operator: FilterOperator::Equals,
                value: Some(json!({
                    "kind": "integer",
                    "value": value
                })),
            }),
            &[column("visits", "UInt128", FilterDialect::Clickhouse)],
            FilterDialect::Clickhouse,
        )
        .unwrap();

        assert_eq!(compiled.sql, "`visits` = {f0:UInt128}");
        assert_eq!(
            compiled.values,
            vec![FilterValue::ExactNumber {
                value: value.to_string(),
                data_type: "UInt128".to_string(),
            }]
        );
    }

    #[test]
    fn preserves_high_precision_decimal_values() {
        let value = "12345678901234567890.123456789012345678";
        let compiled = compile_filter(
            &expression(FilterCondition {
                column: "amount".to_string(),
                operator: FilterOperator::GreaterThan,
                value: Some(json!({
                    "kind": "decimal",
                    "value": value
                })),
            }),
            &[column(
                "amount",
                "Decimal(38, 18)",
                FilterDialect::Clickhouse,
            )],
            FilterDialect::Clickhouse,
        )
        .unwrap();

        assert_eq!(compiled.sql, "`amount` > {f0:Decimal(38, 18)}");
        assert_eq!(
            compiled.values,
            vec![FilterValue::ExactNumber {
                value: value.to_string(),
                data_type: "Decimal(38, 18)".to_string(),
            }]
        );
    }

    #[test]
    fn preserves_postgres_decimal_values() {
        let value = "12345678901234567890.123456789012345678";
        let compiled = compile_filter(
            &expression(FilterCondition {
                column: "amount".to_string(),
                operator: FilterOperator::GreaterThan,
                value: Some(json!({
                    "kind": "decimal",
                    "value": value
                })),
            }),
            &[column("amount", "numeric", FilterDialect::Postgres)],
            FilterDialect::Postgres,
        )
        .unwrap();

        assert_eq!(compiled.sql, "\"amount\" > $1::text::numeric");
        assert_eq!(
            compiled.values,
            vec![FilterValue::ExactNumber {
                value: value.to_string(),
                data_type: "numeric".to_string(),
            }]
        );
    }

    #[test]
    fn table_filter_rejects_conflicting_representations_at_the_boundary() {
        let error = TableFilter::from_parts(
            Some("status = 'active'".to_string()),
            Some(expression(FilterCondition {
                column: "status".to_string(),
                operator: FilterOperator::Equals,
                value: Some(json!("active")),
            })),
        )
        .unwrap_err();

        assert_eq!(
            error,
            "Choose either structured filters or an advanced WHERE clause"
        );
    }

    #[test]
    fn builds_one_canonical_where_clause_for_advanced_filters() {
        let filter = TableFilter::Advanced("name = ‘Cooper’".to_string());

        assert_eq!(
            build_where_clause(Some(&filter), None),
            " WHERE name = 'Cooper'"
        );
    }
}
