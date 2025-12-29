pub const TABLES_QUERY: &str = r#"
SELECT name, type FROM sqlite_master 
WHERE type IN ('table', 'view') AND name NOT LIKE 'sqlite_%'
ORDER BY name;
"#;

pub const COLUMNS_QUERY: &str = r#"
SELECT 
    m.name as table_name,
    p.name as column_name,
    p.type as data_type,
    p."notnull" as not_null,
    p."dflt_value" as default_value,
    p.pk as primary_key
FROM sqlite_master m
CROSS JOIN pragma_table_info(m.name) p
WHERE m.type = 'table' AND m.name NOT LIKE 'sqlite_%'
ORDER BY m.name, p.cid;
"#;

pub const FOREIGN_KEYS_QUERY: &str = r#"
SELECT 
    m.name as table_name,
    f.id as fk_id,
    f."from" as column_name,
    f."table" as references_table,
    f."to" as references_column
FROM sqlite_master m
CROSS JOIN pragma_foreign_key_list(m.name) f
WHERE m.type = 'table' AND m.name NOT LIKE 'sqlite_%'
ORDER BY m.name, f.id;
"#;

pub const INDEXES_QUERY: &str = r#"
SELECT 
    m.name as table_name,
    i.name as index_name,
    i."unique" as is_unique,
    i.origin as origin
FROM sqlite_master m
CROSS JOIN pragma_index_list(m.name) i
WHERE m.type = 'table' AND m.name NOT LIKE 'sqlite_%'
ORDER BY m.name, i.name;
"#;
