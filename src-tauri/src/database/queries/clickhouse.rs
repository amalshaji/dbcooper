pub const COLUMNS_QUERY: &str = r#"
SELECT 
    c.database as schema,
    c.table as name,
    t.engine as type,
    groupArray(tuple(
        c.name,
        c.type,
        c.default_kind,
        c.default_expression,
        c.is_in_primary_key
    )) as columns_raw
FROM system.columns c
JOIN system.tables t ON c.database = t.database AND c.table = t.name
WHERE c.database = currentDatabase()
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
WHERE database = currentDatabase()
GROUP BY database, table;
"#;
