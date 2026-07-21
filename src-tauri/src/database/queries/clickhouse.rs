pub const TABLES_QUERY: &str = r#"
SELECT database, name, engine
FROM system.tables
WHERE database = {database:String}
ORDER BY name;
"#;

pub const TABLE_COLUMNS_QUERY: &str = r#"
SELECT name, type, default_kind, default_expression, is_in_primary_key
FROM system.columns
WHERE database = {database:String} AND table = {table:String}
ORDER BY position;
"#;

pub const TABLE_INDEXES_QUERY: &str = r#"
SELECT name, expr, type
FROM system.data_skipping_indices
WHERE database = {database:String} AND table = {table:String};
"#;

pub const COLUMNS_QUERY: &str = r#"
SELECT 
    c.database as schema,
    c.table as name,
    CASE
        WHEN lower(t.engine) IN ('view', 'materializedview', 'liveview') THEN 'view'
        ELSE 'table'
    END as type,
    groupArray(tuple(
        c.name,
        c.type,
        c.default_kind,
        c.default_expression,
        c.is_in_primary_key
    )) as columns_raw
FROM system.columns c
JOIN system.tables t ON c.database = t.database AND c.table = t.name
WHERE c.database = {database:String}
    AND c.database NOT IN ('system', 'INFORMATION_SCHEMA', 'information_schema')
GROUP BY c.database, c.table, t.engine
ORDER BY c.database, c.table;
"#;

pub const INDEXES_QUERY: &str = r#"
SELECT 
    database,
    table,
    groupArray(tuple(name, expr, type)) as indexes_raw
FROM system.data_skipping_indices
WHERE database = {database:String}
GROUP BY database, table;
"#;

pub const FUNCTION_SUMMARIES_QUERY: &str = r#"
SELECT
    {database:String} AS schema,
    name,
    origin,
    arguments,
    returned_value
FROM system.functions
WHERE origin != 'System'
ORDER BY name;
"#;

pub const FUNCTION_DEFINITION_QUERY: &str = r#"
SELECT
    {database:String} AS schema,
    name,
    origin,
    arguments,
    returned_value,
    create_query
FROM system.functions
WHERE origin != 'System'
    AND name = {name:String}
LIMIT 1;
"#;
