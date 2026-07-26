use std::collections::HashMap;
use std::sync::OnceLock;

use serde::Deserialize;
use serde_json::Value;

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct DialectPolicy {
    label: String,
    file_database: bool,
    structured_row_mutations: bool,
    create_table_types: Vec<String>,
    expressions_by_type: HashMap<String, Vec<String>>,
}

type DatabaseCatalog = HashMap<String, DialectPolicy>;

fn catalog() -> &'static DatabaseCatalog {
    static CATALOG: OnceLock<DatabaseCatalog> = OnceLock::new();
    CATALOG.get_or_init(|| {
        serde_json::from_str(include_str!("../../database-catalog.json"))
            .expect("database catalog must be valid")
    })
}

fn dialect_policy(db_type: &str) -> Result<&'static DialectPolicy, String> {
    let db_type = match db_type {
        "postgresql" => "postgres",
        "sqlite3" => "sqlite",
        other => other,
    };
    catalog()
        .get(db_type)
        .ok_or_else(|| format!("Unsupported database type: {db_type}"))
}

pub fn database_label(db_type: &str) -> Result<&'static str, String> {
    Ok(&dialect_policy(db_type)?.label)
}

pub fn is_file_database(db_type: &str) -> Result<bool, String> {
    Ok(dialect_policy(db_type)?.file_database)
}

pub fn ensure_structured_mutations_supported(db_type: &str) -> Result<(), String> {
    let policy = dialect_policy(db_type)?;
    if policy.structured_row_mutations {
        Ok(())
    } else {
        Err(format!(
            "Structured row editing is not supported for {}; use the SQL editor",
            policy.label
        ))
    }
}

pub fn supports_create_table_type(db_type: &str, data_type: &str) -> Result<bool, String> {
    let normalized = data_type.trim().to_ascii_uppercase();
    Ok(dialect_policy(db_type)?
        .create_table_types
        .iter()
        .any(|candidate| candidate == &normalized))
}

pub fn validate_default_expression(
    db_type: &str,
    data_type: &str,
    value: &str,
) -> Result<(), String> {
    let policy = dialect_policy(db_type)?;
    let normalized_type = data_type.trim().to_ascii_uppercase();
    let normalized_value = value.trim().to_ascii_lowercase();
    let supported = policy
        .expressions_by_type
        .get(&normalized_type)
        .is_some_and(|expressions| {
            expressions
                .iter()
                .any(|expression| expression.to_ascii_lowercase() == normalized_value)
        });

    if supported {
        Ok(())
    } else {
        Err(format!(
            "Default expression is not supported for {} {}",
            policy.label, normalized_type
        ))
    }
}

pub fn validate_raw_sql_value(value: &str, db_type: &str) -> Result<(), String> {
    let normalized = value.trim().to_ascii_lowercase();
    if normalized.is_empty() {
        return Err("Raw SQL value cannot be empty".to_string());
    }

    let supported = dialect_policy(db_type)?
        .expressions_by_type
        .values()
        .flatten()
        .any(|expression| expression.to_ascii_lowercase() == normalized);

    if supported {
        Ok(())
    } else {
        Err(format!(
            "Raw SQL value '{}' is not supported for {}",
            value.trim(),
            database_label(db_type)?
        ))
    }
}

pub fn escape_sql_identifier(identifier: &str) -> String {
    identifier.replace('"', "\"\"")
}

pub fn format_sql_value(value: &Value) -> String {
    match value {
        Value::Null => "NULL".to_string(),
        Value::Bool(value) => {
            if *value {
                "TRUE".to_string()
            } else {
                "FALSE".to_string()
            }
        }
        Value::Number(value) => value.to_string(),
        Value::String(value) => format!("'{}'", value.replace('\'', "''")),
        Value::Array(_) | Value::Object(_) => {
            let json = serde_json::to_string(value).unwrap_or_default();
            format!("'{}'", json.replace('\'', "''"))
        }
    }
}

#[cfg(test)]
mod tests {
    use super::{
        ensure_structured_mutations_supported, supports_create_table_type,
        validate_default_expression, validate_raw_sql_value,
    };

    #[test]
    fn catalog_scopes_types_and_defaults_to_their_dialect() {
        assert!(supports_create_table_type("postgres", "jsonb").unwrap());
        assert!(!supports_create_table_type("sqlite", "jsonb").unwrap());
        assert!(validate_default_expression("postgres", "uuid", "gen_random_uuid()").is_ok());
        assert!(validate_default_expression("postgres", "integer", "gen_random_uuid()").is_err());
    }

    #[test]
    fn raw_sql_values_do_not_cross_dialect_boundaries() {
        assert!(validate_raw_sql_value("now()", "postgres").is_ok());
        assert!(validate_raw_sql_value("today()", "postgres").is_err());
        assert!(validate_raw_sql_value("today()", "clickhouse").is_ok());
    }

    #[test]
    fn structured_mutation_capability_comes_from_the_database_catalog() {
        assert!(ensure_structured_mutations_supported("postgres").is_ok());
        assert!(ensure_structured_mutations_supported("postgresql").is_ok());
        assert!(ensure_structured_mutations_supported("sqlite").is_ok());
        assert!(ensure_structured_mutations_supported("duckdb").is_err());
        assert!(ensure_structured_mutations_supported("clickhouse").is_err());
        assert!(ensure_structured_mutations_supported("redis").is_err());
    }
}
