use crate::db::models::{
    ColumnInfo, ForeignKeyInfo, IndexInfo, QueryResult, TableDataResponse, TableInfo,
    TableStructure, TestConnectionResult,
};
use crate::ssh_tunnel::SshTunnel;
use serde_json::{json, Value};
use sqlx::postgres::PgPoolOptions;
use sqlx::{Column, Row, TypeInfo};

fn build_connection_string(
    host: &str,
    port: i64,
    database: &str,
    username: &str,
    password: &str,
    ssl: bool,
) -> String {
    let ssl_mode = if ssl { "require" } else { "disable" };
    format!(
        "postgres://{}:{}@{}:{}/{}?sslmode={}",
        username, password, host, port, database, ssl_mode
    )
}

#[tauri::command(rename_all = "snake_case")]
pub async fn test_connection(
    host: String,
    port: i64,
    database: String,
    username: String,
    password: String,
    ssl: bool,
    ssh_enabled: Option<bool>,
    ssh_host: Option<String>,
    ssh_port: Option<i64>,
    ssh_user: Option<String>,
    ssh_password: Option<String>,
    ssh_key_path: Option<String>,
    ssh_use_key: Option<bool>,
) -> Result<TestConnectionResult, String> {
    let _tunnel: Option<SshTunnel>;
    println!(
        "[test_connection] SSH params: enabled={:?}, host={:?}, port={:?}, user={:?}, use_key={:?}, key_path={:?}",
        ssh_enabled, ssh_host, ssh_port, ssh_user, ssh_use_key, ssh_key_path
    );
    let (effective_host, effective_port) = if ssh_enabled.unwrap_or(false) {
        let ssh_host_val = ssh_host.unwrap_or_default();
        let ssh_port_val = ssh_port.unwrap_or(22) as u16;
        let ssh_user_val = ssh_user.unwrap_or_default();
        let ssh_password_val = ssh_password.unwrap_or_default();
        let ssh_key_path_val = ssh_key_path.unwrap_or_default();
        let use_key = ssh_use_key.unwrap_or(false);

        let key_path = if use_key && !ssh_key_path_val.is_empty() {
            Some(ssh_key_path_val.as_str())
        } else {
            None
        };
        let password_opt = if !ssh_password_val.is_empty() {
            Some(ssh_password_val.as_str())
        } else {
            None
        };

        match SshTunnel::new(
            &ssh_host_val,
            ssh_port_val,
            &ssh_user_val,
            password_opt,
            key_path,
            &host,
            port as u16,
        )
        .await
        {
            Ok(tunnel) => {
                let local_port = tunnel.local_port;
                _tunnel = Some(tunnel);
                ("127.0.0.1".to_string(), local_port as i64)
            }
            Err(e) => {
                return Ok(TestConnectionResult {
                    success: false,
                    message: format!("SSH tunnel failed: {}", e),
                });
            }
        }
    } else {
        _tunnel = None;
        (host, port)
    };

    let conn_str = build_connection_string(
        &effective_host,
        effective_port,
        &database,
        &username,
        &password,
        ssl,
    );

    match PgPoolOptions::new()
        .max_connections(1)
        .acquire_timeout(std::time::Duration::from_secs(5))
        .connect(&conn_str)
        .await
    {
        Ok(pool) => {
            let result = sqlx::query("SELECT 1").fetch_one(&pool).await;
            pool.close().await;
            match result {
                Ok(_) => Ok(TestConnectionResult {
                    success: true,
                    message: "Connection successful!".to_string(),
                }),
                Err(e) => Ok(TestConnectionResult {
                    success: false,
                    message: format!("Connection failed: {}", e),
                }),
            }
        }
        Err(e) => Ok(TestConnectionResult {
            success: false,
            message: format!("Connection failed: {}", e),
        }),
    }
}

#[tauri::command]
pub async fn list_tables(
    host: String,
    port: i64,
    database: String,
    username: String,
    password: String,
    ssl: bool,
) -> Result<Vec<TableInfo>, String> {
    let conn_str = build_connection_string(&host, port, &database, &username, &password, ssl);

    let pool = PgPoolOptions::new()
        .max_connections(1)
        .connect(&conn_str)
        .await
        .map_err(|e| e.to_string())?;

    let tables = sqlx::query_as::<_, (String, String, String)>(
        r#"
        SELECT 
            table_schema as schema,
            table_name as name,
            CASE 
                WHEN table_type = 'BASE TABLE' THEN 'table'
                WHEN table_type = 'VIEW' THEN 'view'
                ELSE 'table'
            END as type
        FROM information_schema.tables
        WHERE table_schema NOT IN ('pg_catalog', 'information_schema')
        ORDER BY table_schema, table_name
        "#,
    )
    .fetch_all(&pool)
    .await
    .map_err(|e| e.to_string())?;

    pool.close().await;

    Ok(tables
        .into_iter()
        .map(|(schema, name, table_type)| TableInfo {
            schema,
            name,
            table_type,
        })
        .collect())
}

#[tauri::command]
pub async fn get_table_data(
    host: String,
    port: i64,
    database: String,
    username: String,
    password: String,
    ssl: bool,
    schema: String,
    table: String,
    page: i64,
    limit: i64,
    filter: Option<String>,
) -> Result<TableDataResponse, String> {
    let conn_str = build_connection_string(&host, port, &database, &username, &password, ssl);

    let pool = PgPoolOptions::new()
        .max_connections(1)
        .connect(&conn_str)
        .await
        .map_err(|e| e.to_string())?;

    let offset = (page - 1) * limit;
    let full_table_name = format!("\"{}\".\"{}\"", schema, table);
    let where_clause = filter
        .as_ref()
        .map(|f| format!(" WHERE {}", f))
        .unwrap_or_default();

    let count_query = format!(
        "SELECT COUNT(*) as count FROM {}{}",
        full_table_name, where_clause
    );
    let count_row: (i64,) = sqlx::query_as(&count_query)
        .fetch_one(&pool)
        .await
        .map_err(|e| e.to_string())?;
    let total = count_row.0;

    let data_query = format!(
        "SELECT * FROM {}{} LIMIT {} OFFSET {}",
        full_table_name, where_clause, limit, offset
    );

    let rows = sqlx::query(&data_query)
        .fetch_all(&pool)
        .await
        .map_err(|e| e.to_string())?;

    pool.close().await;

    let data: Vec<Value> = rows
        .iter()
        .map(|row| {
            let mut obj = serde_json::Map::new();
            for (i, col) in row.columns().iter().enumerate() {
                let type_name = col.type_info().name();
                let value: Value = match type_name {
                    "INT2" => row
                        .try_get::<i16, _>(i)
                        .map(|v| json!(v))
                        .unwrap_or(Value::Null),
                    "INT4" => row
                        .try_get::<i32, _>(i)
                        .map(|v| json!(v))
                        .unwrap_or(Value::Null),
                    "INT8" => row
                        .try_get::<i64, _>(i)
                        .map(|v| json!(v))
                        .unwrap_or(Value::Null),
                    "FLOAT4" => row
                        .try_get::<f32, _>(i)
                        .map(|v| json!(v))
                        .unwrap_or(Value::Null),
                    "FLOAT8" | "NUMERIC" => row
                        .try_get::<f64, _>(i)
                        .map(|v| json!(v))
                        .unwrap_or(Value::Null),
                    "BOOL" => row
                        .try_get::<bool, _>(i)
                        .map(|v| json!(v))
                        .unwrap_or(Value::Null),
                    "TEXT" | "VARCHAR" | "CHAR" | "BPCHAR" | "NAME" => row
                        .try_get::<String, _>(i)
                        .map(|v| json!(v))
                        .unwrap_or(Value::Null),
                    "UUID" => row
                        .try_get::<uuid::Uuid, _>(i)
                        .map(|v| json!(v.to_string()))
                        .unwrap_or(Value::Null),
                    "TIMESTAMP" | "TIMESTAMPTZ" => row
                        .try_get::<chrono::NaiveDateTime, _>(i)
                        .map(|v| json!(v.to_string()))
                        .or_else(|_| {
                            row.try_get::<chrono::DateTime<chrono::Utc>, _>(i)
                                .map(|v| json!(v.to_string()))
                        })
                        .unwrap_or(Value::Null),
                    "DATE" => row
                        .try_get::<chrono::NaiveDate, _>(i)
                        .map(|v| json!(v.to_string()))
                        .unwrap_or(Value::Null),
                    "TIME" | "TIMETZ" => row
                        .try_get::<chrono::NaiveTime, _>(i)
                        .map(|v| json!(v.to_string()))
                        .unwrap_or(Value::Null),
                    "JSON" | "JSONB" => row
                        .try_get::<serde_json::Value, _>(i)
                        .unwrap_or(Value::Null),
                    "BYTEA" => row
                        .try_get::<Vec<u8>, _>(i)
                        .map(|v| json!(format!("\\x{}", hex::encode(&v))))
                        .unwrap_or(Value::Null),
                    _ => {
                        // For any other type, try to get as string
                        row.try_get::<String, _>(i)
                            .map(|v| json!(v))
                            .unwrap_or_else(|_| json!(format!("<{}>", type_name)))
                    }
                };
                obj.insert(col.name().to_string(), value);
            }
            Value::Object(obj)
        })
        .collect();

    Ok(TableDataResponse {
        data,
        total,
        page,
        limit,
    })
}

#[tauri::command]
pub async fn get_table_structure(
    host: String,
    port: i64,
    database: String,
    username: String,
    password: String,
    ssl: bool,
    schema: String,
    table: String,
) -> Result<TableStructure, String> {
    let conn_str = build_connection_string(&host, port, &database, &username, &password, ssl);

    let pool = PgPoolOptions::new()
        .max_connections(1)
        .connect(&conn_str)
        .await
        .map_err(|e| e.to_string())?;

    let columns = sqlx::query_as::<_, (String, String, bool, Option<String>, bool)>(
        r#"
        SELECT
            c.column_name as name,
            c.data_type as type,
            c.is_nullable = 'YES' as nullable,
            c.column_default as default,
            EXISTS(
                SELECT 1 FROM information_schema.table_constraints tc
                JOIN information_schema.key_column_usage kcu
                ON tc.constraint_name = kcu.constraint_name
                WHERE tc.table_schema = c.table_schema
                AND tc.table_name = c.table_name
                AND kcu.column_name = c.column_name
                AND tc.constraint_type = 'PRIMARY KEY'
            ) as primary_key
        FROM information_schema.columns c
        WHERE c.table_schema = $1
        AND c.table_name = $2
        ORDER BY c.ordinal_position
        "#,
    )
    .bind(&schema)
    .bind(&table)
    .fetch_all(&pool)
    .await
    .map_err(|e| e.to_string())?;

    let indexes = sqlx::query_as::<_, (String, Vec<String>, bool, bool)>(
        r#"
        SELECT
            i.indexname as name,
            array_agg(a.attname)::text[] as columns,
            idx.indisunique as unique,
            idx.indisprimary as primary
        FROM pg_indexes i
        JOIN pg_class c ON c.relname = i.indexname
        JOIN pg_index idx ON idx.indexrelid = c.oid
        JOIN pg_attribute a ON a.attrelid = idx.indrelid AND a.attnum = ANY(idx.indkey)
        WHERE i.schemaname = $1
        AND i.tablename = $2
        GROUP BY i.indexname, idx.indisunique, idx.indisprimary
        "#,
    )
    .bind(&schema)
    .bind(&table)
    .fetch_all(&pool)
    .await
    .map_err(|e| e.to_string())?;

    let foreign_keys = sqlx::query_as::<_, (String, String, String, String)>(
        r#"
        SELECT
            tc.constraint_name as name,
            kcu.column_name as column,
            ccu.table_name as references_table,
            ccu.column_name as references_column
        FROM information_schema.table_constraints tc
        JOIN information_schema.key_column_usage kcu
        ON tc.constraint_name = kcu.constraint_name
        JOIN information_schema.constraint_column_usage ccu
        ON tc.constraint_name = ccu.constraint_name
        WHERE tc.constraint_type = 'FOREIGN KEY'
        AND tc.table_schema = $1
        AND tc.table_name = $2
        "#,
    )
    .bind(&schema)
    .bind(&table)
    .fetch_all(&pool)
    .await
    .map_err(|e| e.to_string())?;

    pool.close().await;

    Ok(TableStructure {
        columns: columns
            .into_iter()
            .map(
                |(name, data_type, nullable, default, primary_key)| ColumnInfo {
                    name,
                    data_type,
                    nullable,
                    default,
                    primary_key,
                },
            )
            .collect(),
        indexes: indexes
            .into_iter()
            .map(|(name, columns, unique, primary)| IndexInfo {
                name,
                columns,
                unique,
                primary,
            })
            .collect(),
        foreign_keys: foreign_keys
            .into_iter()
            .map(
                |(name, column, references_table, references_column)| ForeignKeyInfo {
                    name,
                    column,
                    references_table,
                    references_column,
                },
            )
            .collect(),
    })
}

#[tauri::command]
pub async fn execute_query(
    host: String,
    port: i64,
    database: String,
    username: String,
    password: String,
    ssl: bool,
    query: String,
) -> Result<QueryResult, String> {
    let start_time = std::time::Instant::now();
    let conn_str = build_connection_string(&host, port, &database, &username, &password, ssl);

    let pool = PgPoolOptions::new()
        .max_connections(1)
        .connect(&conn_str)
        .await
        .map_err(|e| e.to_string())?;

    match sqlx::query(&query).fetch_all(&pool).await {
        Ok(rows) => {
            pool.close().await;
            let data: Vec<Value> = rows
                .iter()
                .map(|row| {
                    let mut obj = serde_json::Map::new();
                    for (i, col) in row.columns().iter().enumerate() {
                        let type_name = col.type_info().name();
                        let value: Value = match type_name {
                            "INT2" => row
                                .try_get::<i16, _>(i)
                                .map(|v| json!(v))
                                .unwrap_or(Value::Null),
                            "INT4" => row
                                .try_get::<i32, _>(i)
                                .map(|v| json!(v))
                                .unwrap_or(Value::Null),
                            "INT8" => row
                                .try_get::<i64, _>(i)
                                .map(|v| json!(v))
                                .unwrap_or(Value::Null),
                            "FLOAT4" => row
                                .try_get::<f32, _>(i)
                                .map(|v| json!(v))
                                .unwrap_or(Value::Null),
                            "FLOAT8" | "NUMERIC" => row
                                .try_get::<f64, _>(i)
                                .map(|v| json!(v))
                                .unwrap_or(Value::Null),
                            "BOOL" => row
                                .try_get::<bool, _>(i)
                                .map(|v| json!(v))
                                .unwrap_or(Value::Null),
                            "TEXT" | "VARCHAR" | "CHAR" | "BPCHAR" | "NAME" => row
                                .try_get::<String, _>(i)
                                .map(|v| json!(v))
                                .unwrap_or(Value::Null),
                            "UUID" => row
                                .try_get::<uuid::Uuid, _>(i)
                                .map(|v| json!(v.to_string()))
                                .unwrap_or(Value::Null),
                            "TIMESTAMP" | "TIMESTAMPTZ" => row
                                .try_get::<chrono::NaiveDateTime, _>(i)
                                .map(|v| json!(v.to_string()))
                                .or_else(|_| {
                                    row.try_get::<chrono::DateTime<chrono::Utc>, _>(i)
                                        .map(|v| json!(v.to_string()))
                                })
                                .unwrap_or(Value::Null),
                            "DATE" => row
                                .try_get::<chrono::NaiveDate, _>(i)
                                .map(|v| json!(v.to_string()))
                                .unwrap_or(Value::Null),
                            "TIME" | "TIMETZ" => row
                                .try_get::<chrono::NaiveTime, _>(i)
                                .map(|v| json!(v.to_string()))
                                .unwrap_or(Value::Null),
                            "JSON" | "JSONB" => row
                                .try_get::<serde_json::Value, _>(i)
                                .unwrap_or(Value::Null),
                            "BYTEA" => row
                                .try_get::<Vec<u8>, _>(i)
                                .map(|v| json!(format!("\\x{}", hex::encode(&v))))
                                .unwrap_or(Value::Null),
                            _ => row
                                .try_get::<String, _>(i)
                                .map(|v| json!(v))
                                .unwrap_or_else(|_| json!(format!("<{}>", type_name))),
                        };
                        obj.insert(col.name().to_string(), value);
                    }
                    Value::Object(obj)
                })
                .collect();

            let row_count = data.len() as i64;
            Ok(QueryResult {
                data,
                row_count,
                error: None,
                time_taken_ms: Some(start_time.elapsed().as_millis()),
            })
        }
        Err(e) => {
            pool.close().await;
            Ok(QueryResult {
                data: vec![],
                row_count: 0,
                error: Some(e.to_string()),
                time_taken_ms: Some(start_time.elapsed().as_millis()),
            })
        }
    }
}
