use super::sql_policy::{escape_sql_identifier, format_sql_value, validate_raw_sql_value};
use super::DatabaseType;
use serde::Deserialize;
use serde_json::Value;

#[derive(Clone, Debug, PartialEq)]
pub struct MutationPlan {
    pub sql: String,
    pub values: Vec<Value>,
}

#[derive(Clone, Debug, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct MutationValue {
    pub column: String,
    pub value: Value,
    #[serde(default)]
    pub is_raw_sql: bool,
}

pub fn build_update(
    engine: DatabaseType,
    schema: &str,
    table: &str,
    primary_key_columns: &[String],
    primary_key_values: &[Value],
    updates: &[MutationValue],
) -> Result<MutationPlan, String> {
    validate_primary_key(primary_key_columns, primary_key_values)?;
    if updates.is_empty() {
        return Err("No updates provided".to_string());
    }

    let mut values = Vec::new();
    let set_clause = updates
        .iter()
        .map(|update| {
            Ok(format!(
                "{} = {}",
                identifier(&update.column, engine),
                mutation_value(update, engine, &mut values)?
            ))
        })
        .collect::<Result<Vec<_>, String>>()?
        .join(", ");
    let where_clause =
        build_where_clause(engine, primary_key_columns, primary_key_values, &mut values);

    Ok(MutationPlan {
        sql: format!(
            "UPDATE {} SET {} WHERE {}",
            table_reference(schema, table, engine),
            set_clause,
            where_clause
        ),
        values,
    })
}

pub fn build_delete(
    engine: DatabaseType,
    schema: &str,
    table: &str,
    primary_key_columns: &[String],
    primary_key_values: &[Value],
) -> Result<MutationPlan, String> {
    validate_primary_key(primary_key_columns, primary_key_values)?;
    let mut values = Vec::new();
    let where_clause =
        build_where_clause(engine, primary_key_columns, primary_key_values, &mut values);
    Ok(MutationPlan {
        sql: format!(
            "DELETE FROM {} WHERE {}",
            table_reference(schema, table, engine),
            where_clause
        ),
        values,
    })
}

pub fn build_insert(
    engine: DatabaseType,
    schema: &str,
    table: &str,
    insert_values: &[MutationValue],
) -> Result<MutationPlan, String> {
    if insert_values.is_empty() {
        return Err("No values provided".to_string());
    }

    let mut values = Vec::new();
    let columns = insert_values
        .iter()
        .map(|value| identifier(&value.column, engine))
        .collect::<Vec<_>>()
        .join(", ");
    let value_clause = insert_values
        .iter()
        .map(|value| mutation_value(value, engine, &mut values))
        .collect::<Result<Vec<_>, String>>()?
        .join(", ");

    Ok(MutationPlan {
        sql: format!(
            "INSERT INTO {} ({}) VALUES ({})",
            table_reference(schema, table, engine),
            columns,
            value_clause
        ),
        values,
    })
}

fn validate_primary_key(columns: &[String], values: &[Value]) -> Result<(), String> {
    if columns.is_empty() || columns.len() != values.len() {
        Err("Primary key columns and values must match".to_string())
    } else {
        Ok(())
    }
}

fn build_where_clause(
    engine: DatabaseType,
    columns: &[String],
    primary_key_values: &[Value],
    values: &mut Vec<Value>,
) -> String {
    columns
        .iter()
        .zip(primary_key_values)
        .map(|(column, value)| {
            let identifier = identifier(column, engine);
            if parameterized(engine) {
                if value.is_null() {
                    format!("{identifier} IS NULL")
                } else {
                    values.push(value.clone());
                    format!("{identifier} = ?")
                }
            } else {
                format!("{identifier} = {}", format_sql_value(value))
            }
        })
        .collect::<Vec<_>>()
        .join(" AND ")
}

fn mutation_value(
    value: &MutationValue,
    engine: DatabaseType,
    values: &mut Vec<Value>,
) -> Result<String, String> {
    if value.is_raw_sql {
        let raw = value
            .value
            .as_str()
            .ok_or("Raw SQL value must be a string")?;
        validate_raw_sql_value(raw, engine.as_str())
            .map_err(|error| format!("Invalid raw SQL value: {error}"))?;
        Ok(raw.to_string())
    } else if parameterized(engine) {
        values.push(value.value.clone());
        Ok("?".to_string())
    } else {
        Ok(format_sql_value(&value.value))
    }
}

fn parameterized(engine: DatabaseType) -> bool {
    matches!(engine, DatabaseType::Mysql | DatabaseType::Mariadb)
}

fn identifier(value: &str, engine: DatabaseType) -> String {
    if parameterized(engine) {
        format!("`{}`", value.replace('`', "``"))
    } else {
        format!("\"{}\"", escape_sql_identifier(value))
    }
}

fn table_reference(schema: &str, table: &str, engine: DatabaseType) -> String {
    if engine == DatabaseType::Sqlite {
        identifier(table, engine)
    } else {
        format!(
            "{}.{}",
            identifier(schema, engine),
            identifier(table, engine)
        )
    }
}

#[cfg(test)]
mod tests {
    use super::{build_delete, build_insert, build_update, MutationValue};
    use crate::database::DatabaseType;
    use serde_json::json;

    #[test]
    fn mysql_update_uses_bound_values_and_backtick_identifiers() {
        let plan = build_update(
            DatabaseType::Mysql,
            "app",
            "orders",
            &["id".to_string()],
            &[json!(7)],
            &[MutationValue {
                column: "customer`name".to_string(),
                value: json!("Ada"),
                is_raw_sql: false,
            }],
        )
        .unwrap();

        assert_eq!(
            plan.sql,
            "UPDATE `app`.`orders` SET `customer``name` = ? WHERE `id` = ?"
        );
        assert_eq!(plan.values, vec![json!("Ada"), json!(7)]);
    }

    #[test]
    fn non_mysql_mutations_remain_literal_and_sqlite_omits_schema() {
        let delete = build_delete(
            DatabaseType::Postgres,
            "public",
            "orders",
            &["id".to_string()],
            &[json!(7)],
        )
        .unwrap();
        assert_eq!(
            delete.sql,
            "DELETE FROM \"public\".\"orders\" WHERE \"id\" = 7"
        );
        assert!(delete.values.is_empty());

        let insert = build_insert(
            DatabaseType::Sqlite,
            "main",
            "orders",
            &[MutationValue {
                column: "name".to_string(),
                value: json!("Ada"),
                is_raw_sql: false,
            }],
        )
        .unwrap();
        assert_eq!(
            insert.sql,
            "INSERT INTO \"orders\" (\"name\") VALUES ('Ada')"
        );
        assert!(insert.values.is_empty());
    }

    #[test]
    fn mysql_null_keys_are_not_bound() {
        let plan = build_delete(
            DatabaseType::Mariadb,
            "app",
            "orders",
            &["deleted_at".to_string()],
            &[serde_json::Value::Null],
        )
        .unwrap();

        assert_eq!(
            plan.sql,
            "DELETE FROM `app`.`orders` WHERE `deleted_at` IS NULL"
        );
        assert!(plan.values.is_empty());
    }

    #[test]
    fn mutation_values_deserialize_the_tauri_contract() {
        let value: MutationValue = serde_json::from_value(json!({
            "column": "updated_at",
            "value": "now()",
            "isRawSql": true
        }))
        .unwrap();

        assert_eq!(value.column, "updated_at");
        assert!(value.is_raw_sql);
    }
}
