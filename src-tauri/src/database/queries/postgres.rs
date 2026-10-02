pub const SCHEMA_OVERVIEW_QUERY: &str = r#"
SELECT
    n.nspname AS schema,
    c.relname AS name,
    CASE WHEN c.relkind = 'v' THEN 'view' ELSE 'table' END AS type,
    cols.columns,
    fks.foreign_keys,
    idx.indexes
FROM pg_catalog.pg_class AS c
JOIN pg_catalog.pg_namespace AS n ON n.oid = c.relnamespace
CROSS JOIN LATERAL (
    SELECT json_agg(json_build_object(
        'name', a.attname,
        'type', CASE
            WHEN t.typtype = 'd' THEN CASE
                WHEN bt.typelem <> 0 AND bt.typlen = -1 THEN 'ARRAY'
                WHEN bn.nspname = 'pg_catalog' THEN pg_catalog.format_type(t.typbasetype, NULL)
                ELSE 'USER-DEFINED'
            END
            WHEN t.typelem <> 0 AND t.typlen = -1 THEN 'ARRAY'
            WHEN tn.nspname = 'pg_catalog' THEN pg_catalog.format_type(a.atttypid, NULL)
            ELSE 'USER-DEFINED'
        END,
        'nullable', NOT (a.attnotnull OR (t.typtype = 'd' AND t.typnotnull)),
        'default', CASE WHEN a.attgenerated = '' THEN pg_catalog.pg_get_expr(d.adbin, d.adrelid) END,
        'primary_key', EXISTS (
            SELECT 1
            FROM pg_catalog.pg_constraint AS pk
            WHERE pk.conrelid = c.oid
                AND pk.contype = 'p'
                AND a.attnum = ANY (pk.conkey)
                AND (
                    pg_catalog.pg_has_role(c.relowner, 'USAGE')
                    OR pg_catalog.has_table_privilege(c.oid, 'INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER')
                    OR pg_catalog.has_any_column_privilege(c.oid, 'INSERT, UPDATE, REFERENCES')
                )
        )
    ) ORDER BY a.attnum) AS columns
    FROM pg_catalog.pg_attribute AS a
    JOIN pg_catalog.pg_type AS t ON t.oid = a.atttypid
    JOIN pg_catalog.pg_namespace AS tn ON tn.oid = t.typnamespace
    LEFT JOIN pg_catalog.pg_type AS bt ON t.typtype = 'd' AND bt.oid = t.typbasetype
    LEFT JOIN pg_catalog.pg_namespace AS bn ON bn.oid = bt.typnamespace
    LEFT JOIN pg_catalog.pg_attrdef AS d ON d.adrelid = a.attrelid AND d.adnum = a.attnum
    WHERE a.attrelid = c.oid
        AND a.attnum > 0
        AND NOT a.attisdropped
        AND (
            pg_catalog.pg_has_role(c.relowner, 'USAGE')
            OR pg_catalog.has_column_privilege(c.oid, a.attnum, 'SELECT, INSERT, UPDATE, REFERENCES')
        )
) AS cols
CROSS JOIN LATERAL (
    SELECT COALESCE(json_agg(json_build_object(
        'name', fk.conname,
        'column', src.attname,
        'references_table', target.relname,
        'references_column', dst.attname
    ) ORDER BY fk.oid, pair.ord), '[]'::json) AS foreign_keys
    FROM pg_catalog.pg_constraint AS fk
    JOIN pg_catalog.pg_class AS target ON target.oid = fk.confrelid
    CROSS JOIN LATERAL unnest(fk.conkey, fk.confkey) WITH ORDINALITY AS pair(src_num, dst_num, ord)
    JOIN pg_catalog.pg_attribute AS src ON src.attrelid = c.oid AND src.attnum = pair.src_num
    JOIN pg_catalog.pg_attribute AS dst ON dst.attrelid = target.oid AND dst.attnum = pair.dst_num
    WHERE fk.conrelid = c.oid
        AND fk.contype = 'f'
        AND pg_catalog.pg_has_role(target.relowner, 'USAGE')
        AND (
            pg_catalog.pg_has_role(c.relowner, 'USAGE')
            OR pg_catalog.has_table_privilege(c.oid, 'INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER')
            OR pg_catalog.has_any_column_privilege(c.oid, 'INSERT, UPDATE, REFERENCES')
        )
        AND (
            pg_catalog.pg_has_role(c.relowner, 'USAGE')
            OR pg_catalog.has_column_privilege(c.oid, src.attnum, 'SELECT, INSERT, UPDATE, REFERENCES')
        )
) AS fks
CROSS JOIN LATERAL (
    SELECT COALESCE(json_agg(json_build_object(
        'name', ic.relname,
        'columns', (
            SELECT array_agg(pg_catalog.pg_get_indexdef(i.indexrelid, k, true) ORDER BY k)
            FROM pg_catalog.generate_series(1, i.indnkeyatts) AS k
        ),
        'unique', i.indisunique,
        'primary', i.indisprimary
    ) ORDER BY ic.relname), '[]'::json) AS indexes
    FROM pg_catalog.pg_index AS i
    JOIN pg_catalog.pg_class AS ic ON ic.oid = i.indexrelid
    WHERE i.indrelid = c.oid
) AS idx
WHERE c.relkind IN ('r', 'p', 'v', 'f')
    AND n.nspname NOT IN ('pg_catalog', 'information_schema')
    AND NOT pg_catalog.pg_is_other_temp_schema(n.oid)
    AND (
        pg_catalog.pg_has_role(c.relowner, 'USAGE')
        OR pg_catalog.has_table_privilege(c.oid, 'SELECT, INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER')
        OR pg_catalog.has_any_column_privilege(c.oid, 'SELECT, INSERT, UPDATE, REFERENCES')
    )
    AND cols.columns IS NOT NULL
ORDER BY n.nspname, c.relname;
"#;

pub const FUNCTION_SUMMARIES_QUERY: &str = r#"
SELECT
    n.nspname AS schema,
    p.proname AS name,
    pg_get_function_identity_arguments(p.oid) AS identity_args,
    pg_get_function_arguments(p.oid) AS arguments,
    pg_get_function_result(p.oid) AS return_type,
    l.lanname AS language
FROM pg_proc p
JOIN pg_namespace n ON n.oid = p.pronamespace
JOIN pg_language l ON l.oid = p.prolang
WHERE p.prokind = 'f'
    AND n.nspname NOT IN ('pg_catalog', 'information_schema')
ORDER BY n.nspname, p.proname, pg_get_function_identity_arguments(p.oid);
"#;

pub const FUNCTION_DEFINITION_QUERY: &str = r#"
SELECT
    n.nspname AS schema,
    p.proname AS name,
    pg_get_function_identity_arguments(p.oid) AS identity_args,
    pg_get_function_arguments(p.oid) AS arguments,
    pg_get_function_result(p.oid) AS return_type,
    l.lanname AS language,
    pg_get_functiondef(p.oid) AS definition
FROM pg_proc p
JOIN pg_namespace n ON n.oid = p.pronamespace
JOIN pg_language l ON l.oid = p.prolang
WHERE p.prokind = 'f'
    AND n.nspname = $1
    AND p.proname = $2
    AND pg_get_function_identity_arguments(p.oid) = $3
LIMIT 1;
"#;
