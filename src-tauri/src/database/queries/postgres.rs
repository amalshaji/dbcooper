pub const SCHEMA_OVERVIEW_QUERY: &str = r#"
WITH columns_data AS (
    SELECT 
        c.table_schema,
        c.table_name,
        json_agg(json_build_object(
            'name', c.column_name,
            'type', c.data_type,
            'nullable', c.is_nullable = 'YES',
            'default', c.column_default,
            'primary_key', CASE WHEN pk.column_name IS NOT NULL THEN true ELSE false END
        ) ORDER BY c.ordinal_position) as columns
    FROM information_schema.columns c
    LEFT JOIN (
        SELECT ku.table_schema, ku.table_name, ku.column_name
        FROM information_schema.table_constraints tc
        JOIN information_schema.key_column_usage ku
            ON tc.constraint_name = ku.constraint_name
            AND tc.table_schema = ku.table_schema
        WHERE tc.constraint_type = 'PRIMARY KEY'
    ) pk ON c.table_schema = pk.table_schema 
        AND c.table_name = pk.table_name 
        AND c.column_name = pk.column_name
    WHERE c.table_schema NOT IN ('pg_catalog', 'information_schema')
    GROUP BY c.table_schema, c.table_name
),
foreign_keys_data AS (
    SELECT 
        tc.table_schema,
        tc.table_name,
        json_agg(json_build_object(
            'name', tc.constraint_name,
            'column', kcu.column_name,
            'references_table', ccu.table_name,
            'references_column', ccu.column_name
        )) as foreign_keys
    FROM information_schema.table_constraints tc
    JOIN information_schema.key_column_usage kcu
        ON tc.constraint_name = kcu.constraint_name
        AND tc.table_schema = kcu.table_schema
    JOIN information_schema.constraint_column_usage ccu
        ON ccu.constraint_name = tc.constraint_name
    WHERE tc.constraint_type = 'FOREIGN KEY'
        AND tc.table_schema NOT IN ('pg_catalog', 'information_schema')
    GROUP BY tc.table_schema, tc.table_name
),
indexes_data AS (
    SELECT 
        schemaname as table_schema,
        tablename as table_name,
        json_agg(json_build_object(
            'name', indexname,
            'columns', regexp_split_to_array(
                substring(indexdef from '\((.*)\)'), ', '
            ),
            'unique', indexdef LIKE '%UNIQUE%',
            'primary', indexdef LIKE '%PRIMARY%'
        )) as indexes
    FROM pg_indexes
    WHERE schemaname NOT IN ('pg_catalog', 'information_schema')
    GROUP BY schemaname, tablename
)
SELECT 
    cd.table_schema as schema,
    cd.table_name as name,
    'table' as type,
    cd.columns,
    COALESCE(fk.foreign_keys, '[]'::json) as foreign_keys,
    COALESCE(idx.indexes, '[]'::json) as indexes
FROM columns_data cd
LEFT JOIN foreign_keys_data fk 
    ON cd.table_schema = fk.table_schema 
    AND cd.table_name = fk.table_name
LEFT JOIN indexes_data idx 
    ON cd.table_schema = idx.table_schema 
    AND cd.table_name = idx.table_name
ORDER BY cd.table_schema, cd.table_name;
"#;
