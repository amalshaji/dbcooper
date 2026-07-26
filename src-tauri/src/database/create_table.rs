use std::collections::HashSet;

use super::sql_policy::{
    database_label, escape_sql_identifier, format_sql_value, supports_create_table_type,
    validate_default_expression,
};
use crate::db::models::{ColumnDefault, CreateTableColumn, CreateTableRequest};
use serde_json::Value;

#[derive(Clone, Copy)]
enum CreateTableDialect {
    Postgres,
    Sqlite,
    Mysql,
    Mariadb,
}

impl CreateTableDialect {
    fn key(self) -> &'static str {
        match self {
            Self::Postgres => "postgres",
            Self::Sqlite => "sqlite",
            Self::Mysql => "mysql",
            Self::Mariadb => "mariadb",
        }
    }
}

pub fn build_postgres_create_table_sql(request: &CreateTableRequest) -> Result<String, String> {
    build_create_table_sql(request, CreateTableDialect::Postgres)
}

pub fn build_sqlite_create_table_sql(request: &CreateTableRequest) -> Result<String, String> {
    build_create_table_sql(request, CreateTableDialect::Sqlite)
}

pub fn build_mysql_create_table_sql(request: &CreateTableRequest) -> Result<String, String> {
    build_create_table_sql(request, CreateTableDialect::Mysql)
}

pub fn build_mariadb_create_table_sql(request: &CreateTableRequest) -> Result<String, String> {
    build_create_table_sql(request, CreateTableDialect::Mariadb)
}

fn build_create_table_sql(
    request: &CreateTableRequest,
    dialect: CreateTableDialect,
) -> Result<String, String> {
    validate_identifier(&request.schema, "Schema")?;
    validate_identifier(&request.name, "Table")?;

    if matches!(dialect, CreateTableDialect::Sqlite) && request.schema != "main" {
        return Err("SQLite tables must be created in the main schema".to_string());
    }
    if request.columns.is_empty() {
        return Err("Add at least one column".to_string());
    }

    let mut names = HashSet::new();
    let mut definitions = Vec::with_capacity(request.columns.len() + 1);
    let mut primary_keys = Vec::new();

    for column in &request.columns {
        validate_identifier(&column.name, "Column")?;
        if !names.insert(column.name.as_str()) {
            return Err("Column names must be unique".to_string());
        }

        definitions.push(build_column_definition(column, dialect)?);
        if column.primary_key {
            primary_keys.push(quote_identifier(&column.name, dialect));
        }
    }

    if !primary_keys.is_empty() {
        definitions.push(format!("PRIMARY KEY ({})", primary_keys.join(", ")));
    }

    let body = definitions
        .into_iter()
        .map(|definition| format!("  {definition}"))
        .collect::<Vec<_>>()
        .join(",\n");

    Ok(format!(
        "CREATE TABLE {}.{} (\n{}\n);",
        quote_identifier(&request.schema, dialect),
        quote_identifier(&request.name, dialect),
        body
    ))
}

fn build_column_definition(
    column: &CreateTableColumn,
    dialect: CreateTableDialect,
) -> Result<String, String> {
    let data_type = column.data_type.trim().to_ascii_uppercase();
    if !supports_create_table_type(dialect.key(), &data_type)? {
        return Err(format!(
            "Unsupported {} data type: {}",
            database_label(dialect.key())?,
            column.data_type
        ));
    }

    let data_type = format_data_type(column, dialect, &data_type)?;
    let mut definition = format!("{} {}", quote_identifier(&column.name, dialect), data_type);
    if let Some(default) = &column.default {
        definition.push_str(" DEFAULT ");
        definition.push_str(&format_default(default, dialect, &data_type)?);
    }
    if !column.nullable || column.primary_key {
        definition.push_str(" NOT NULL");
    }
    if column.unique {
        definition.push_str(" UNIQUE");
    }
    if column.auto_increment {
        if !matches!(
            dialect,
            CreateTableDialect::Mysql | CreateTableDialect::Mariadb
        ) {
            return Err("Auto increment is only supported for MySQL and MariaDB".to_string());
        }
        if !column.primary_key {
            return Err("Auto increment columns must be primary keys".to_string());
        }
        if !matches!(
            data_type
                .split(['(', ' '])
                .next()
                .unwrap_or(data_type.as_str()),
            "TINYINT" | "SMALLINT" | "MEDIUMINT" | "INT" | "INTEGER" | "BIGINT"
        ) {
            return Err("Auto increment columns must use an integer type".to_string());
        }
        definition.push_str(" AUTO_INCREMENT");
    }

    Ok(definition)
}

fn format_data_type(
    column: &CreateTableColumn,
    dialect: CreateTableDialect,
    data_type: &str,
) -> Result<String, String> {
    let mysql = matches!(
        dialect,
        CreateTableDialect::Mysql | CreateTableDialect::Mariadb
    );
    if !mysql
        && (column.length.is_some()
            || column.precision.is_some()
            || column.scale.is_some()
            || column.unsigned)
    {
        return Err("Type modifiers are only supported for MySQL and MariaDB".to_string());
    }

    let mut result = data_type.to_string();
    if let Some(length) = column.length {
        if !matches!(data_type, "CHAR" | "VARCHAR" | "BINARY" | "VARBINARY") || length == 0 {
            return Err(format!("Length is not supported for {data_type}"));
        }
        result.push_str(&format!("({length})"));
    }
    if column.precision.is_some() || column.scale.is_some() {
        if !matches!(data_type, "DECIMAL" | "NUMERIC") {
            return Err(format!(
                "Precision and scale are not supported for {data_type}"
            ));
        }
        let precision = column
            .precision
            .ok_or("Precision is required when scale is set")?;
        let scale = column.scale.unwrap_or(0);
        if precision == 0 || precision > 65 || scale > 30 || scale > precision {
            return Err("Decimal precision must be 1-65 and scale must be 0-30 and no larger than precision".to_string());
        }
        result.push_str(&format!("({precision},{scale})"));
    }
    if column.unsigned {
        if !matches!(
            data_type,
            "TINYINT"
                | "SMALLINT"
                | "MEDIUMINT"
                | "INT"
                | "INTEGER"
                | "BIGINT"
                | "DECIMAL"
                | "NUMERIC"
                | "FLOAT"
                | "DOUBLE"
        ) {
            return Err(format!("Unsigned is not supported for {data_type}"));
        }
        result.push_str(" UNSIGNED");
    }
    Ok(result)
}

fn format_default(
    default: &ColumnDefault,
    dialect: CreateTableDialect,
    data_type: &str,
) -> Result<String, String> {
    match default {
        ColumnDefault::Literal { value } => format_literal(value),
        ColumnDefault::Expression { value } => {
            let expression = value.trim();
            validate_default_expression(dialect.key(), data_type, expression)?;
            Ok(expression.to_string())
        }
    }
}

fn format_literal(value: &Value) -> Result<String, String> {
    match value {
        Value::Bool(_) | Value::Number(_) | Value::String(_) => Ok(format_sql_value(value)),
        _ => Err("Default literal must be text, a number, or a boolean".to_string()),
    }
}

fn validate_identifier(identifier: &str, field: &str) -> Result<(), String> {
    let mut chars = identifier.chars();
    let first_is_valid = chars
        .next()
        .is_some_and(|character| character == '_' || character.is_ascii_lowercase());
    let rest_is_valid = chars.all(|character| {
        character == '_' || character.is_ascii_lowercase() || character.is_ascii_digit()
    });

    if first_is_valid && rest_is_valid {
        Ok(())
    } else {
        Err(format!(
            "{field} name must use lowercase letters, numbers, and underscores"
        ))
    }
}

fn quote_identifier(identifier: &str, dialect: CreateTableDialect) -> String {
    if matches!(
        dialect,
        CreateTableDialect::Mysql | CreateTableDialect::Mariadb
    ) {
        format!("`{}`", identifier.replace('`', "``"))
    } else {
        format!("\"{}\"", escape_sql_identifier(identifier))
    }
}

#[cfg(test)]
mod tests {
    use super::{
        build_mysql_create_table_sql, build_postgres_create_table_sql,
        build_sqlite_create_table_sql,
    };
    use crate::db::models::{ColumnDefault, CreateTableColumn, CreateTableRequest};
    use serde_json::json;

    fn column(name: &str, data_type: &str) -> CreateTableColumn {
        CreateTableColumn {
            name: name.to_string(),
            data_type: data_type.to_string(),
            nullable: true,
            primary_key: false,
            unique: false,
            default: None,
            length: None,
            precision: None,
            scale: None,
            unsigned: false,
            auto_increment: false,
        }
    }

    #[test]
    fn mysql_builder_supports_native_basic_modifiers() {
        let mut id = column("id", "bigint");
        id.nullable = false;
        id.primary_key = true;
        id.unsigned = true;
        id.auto_increment = true;
        let mut name = column("name", "varchar");
        name.length = Some(191);
        let mut amount = column("amount", "decimal");
        amount.precision = Some(12);
        amount.scale = Some(2);

        let sql = build_mysql_create_table_sql(&CreateTableRequest {
            schema: "app".to_string(),
            name: "orders".to_string(),
            columns: vec![id, name, amount],
        })
        .unwrap();

        assert_eq!(sql, "CREATE TABLE `app`.`orders` (\n  `id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,\n  `name` VARCHAR(191),\n  `amount` DECIMAL(12,2),\n  PRIMARY KEY (`id`)\n);");
    }

    #[test]
    fn mysql_builder_rejects_auto_increment_on_non_integer_columns() {
        let mut id = column("id", "varchar");
        id.length = Some(32);
        id.primary_key = true;
        id.auto_increment = true;

        let error = build_mysql_create_table_sql(&CreateTableRequest {
            schema: "app".to_string(),
            name: "orders".to_string(),
            columns: vec![id],
        })
        .unwrap_err();

        assert_eq!(error, "Auto increment columns must use an integer type");
    }

    #[test]
    fn postgres_builder_generates_reviewable_sql_with_composite_constraints() {
        let mut account_id = column("account_id", "bigint");
        account_id.nullable = false;
        account_id.primary_key = true;

        let mut sequence = column("sequence", "integer");
        sequence.nullable = false;
        sequence.primary_key = true;
        sequence.default = Some(ColumnDefault::Literal { value: json!(0) });

        let mut email = column("email", "text");
        email.unique = true;

        let mut created_at = column("created_at", "timestamptz");
        created_at.nullable = false;
        created_at.default = Some(ColumnDefault::Expression {
            value: "current_timestamp".to_string(),
        });

        let request = CreateTableRequest {
            schema: "public".to_string(),
            name: "account_events".to_string(),
            columns: vec![account_id, sequence, email, created_at],
        };

        let sql = build_postgres_create_table_sql(&request).unwrap();

        assert_eq!(
            sql,
            "CREATE TABLE \"public\".\"account_events\" (\n  \"account_id\" BIGINT NOT NULL,\n  \"sequence\" INTEGER DEFAULT 0 NOT NULL,\n  \"email\" TEXT UNIQUE,\n  \"created_at\" TIMESTAMPTZ DEFAULT current_timestamp NOT NULL,\n  PRIMARY KEY (\"account_id\", \"sequence\")\n);"
        );
    }

    #[test]
    fn sqlite_builder_qualifies_main_and_escapes_literal_defaults() {
        let mut id = column("id", "integer");
        id.nullable = false;
        id.primary_key = true;

        let mut label = column("label", "text");
        label.default = Some(ColumnDefault::Literal {
            value: json!("owner's"),
        });

        let request = CreateTableRequest {
            schema: "main".to_string(),
            name: "labels".to_string(),
            columns: vec![id, label],
        };

        let sql = build_sqlite_create_table_sql(&request).unwrap();

        assert_eq!(
            sql,
            "CREATE TABLE \"main\".\"labels\" (\n  \"id\" INTEGER NOT NULL,\n  \"label\" TEXT DEFAULT 'owner''s',\n  PRIMARY KEY (\"id\")\n);"
        );
    }

    #[test]
    fn builders_reject_identifiers_the_current_ui_cannot_round_trip() {
        let request = CreateTableRequest {
            schema: "public".to_string(),
            name: "MixedCase".to_string(),
            columns: vec![column("id", "integer")],
        };

        assert_eq!(
            build_postgres_create_table_sql(&request).unwrap_err(),
            "Table name must use lowercase letters, numbers, and underscores"
        );
    }

    #[test]
    fn builders_reject_duplicate_columns_and_arbitrary_expressions() {
        let mut created_at = column("created_at", "datetime");
        created_at.default = Some(ColumnDefault::Expression {
            value: "datetime('now'); drop table users".to_string(),
        });

        let duplicate_request = CreateTableRequest {
            schema: "main".to_string(),
            name: "events".to_string(),
            columns: vec![column("event_id", "integer"), column("event_id", "text")],
        };
        let expression_request = CreateTableRequest {
            schema: "main".to_string(),
            name: "events".to_string(),
            columns: vec![created_at],
        };

        assert_eq!(
            build_sqlite_create_table_sql(&duplicate_request).unwrap_err(),
            "Column names must be unique"
        );
        assert_eq!(
            build_sqlite_create_table_sql(&expression_request).unwrap_err(),
            "Default expression is not supported for SQLite DATETIME"
        );
    }

    #[test]
    fn builders_reject_defaults_that_do_not_match_the_column_type() {
        let mut attempts = column("attempts", "integer");
        attempts.default = Some(ColumnDefault::Expression {
            value: "gen_random_uuid()".to_string(),
        });
        let request = CreateTableRequest {
            schema: "public".to_string(),
            name: "jobs".to_string(),
            columns: vec![attempts],
        };

        assert_eq!(
            build_postgres_create_table_sql(&request).unwrap_err(),
            "Default expression is not supported for PostgreSQL INTEGER"
        );
    }
}
