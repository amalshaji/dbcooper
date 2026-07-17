use crate::db::models::{FilterConjunction, FilterExpression, FilterOperator, TableFilter};
use serde_json::Value;

const MAX_CONDITIONS: usize = 20;
const MAX_IN_VALUES: usize = 100;

#[derive(Debug, Clone, Copy)]
pub enum FilterDialect {
    Postgres,
    Sqlite,
    Clickhouse,
}

#[derive(Debug, Clone, PartialEq)]
pub enum FilterValue {
    Text(String),
    Integer(i64),
    Float(f64),
    Boolean(bool),
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
    allowed_columns: &[String],
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
        if !allowed_columns.contains(&condition.column) {
            return Err(format!("Unknown filter column: {}", condition.column));
        }

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
                    let value = parse_value(item)?;
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
                let mut value = parse_value(raw_value)?;
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

fn parse_value(value: &Value) -> Result<FilterValue, String> {
    match value {
        Value::Object(value) if value.get("kind").and_then(Value::as_str) == Some("integer") => {
            value
                .get("value")
                .and_then(Value::as_str)
                .ok_or_else(|| "Integer filter value must be a string".to_string())?
                .parse::<i64>()
                .map(FilterValue::Integer)
                .map_err(|_| "Integer filter value is out of range".to_string())
        }
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
        FilterDialect::Postgres => format!("${}", index + 1),
        FilterDialect::Sqlite => "?".to_string(),
        FilterDialect::Clickhouse => {
            let value_type = match value {
                FilterValue::Text(_) => "String",
                FilterValue::Integer(_) => "Int64",
                FilterValue::Float(_) => "Float64",
                FilterValue::Boolean(_) => "UInt8",
            };
            format!("{{f{index}:{value_type}}}")
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::db::models::{FilterCondition, FilterConjunction, FilterExpression, FilterOperator};
    use serde_json::json;

    fn expression(condition: FilterCondition) -> FilterExpression {
        FilterExpression {
            conjunction: FilterConjunction::And,
            conditions: vec![condition],
        }
    }

    #[test]
    fn compiles_postgres_values_as_parameters() {
        let compiled = compile_filter(
            &expression(FilterCondition {
                column: "status".to_string(),
                operator: FilterOperator::Equals,
                value: Some(json!("active")),
            }),
            &["status".to_string()],
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
            &["name".to_string()],
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
            &["deleted_at".to_string()],
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
            &["email".to_string()],
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
            &["external_id".to_string()],
            FilterDialect::Postgres,
        )
        .unwrap();

        assert_eq!(
            compiled.values,
            vec![FilterValue::Integer(9_007_199_254_740_993)]
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
