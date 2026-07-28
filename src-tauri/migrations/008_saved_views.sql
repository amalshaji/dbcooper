CREATE TABLE IF NOT EXISTS saved_views (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    connection_uuid TEXT NOT NULL,
    table_name TEXT NOT NULL,
    name TEXT NOT NULL COLLATE NOCASE,
    state_json TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now')),
    FOREIGN KEY (connection_uuid) REFERENCES connections(uuid) ON DELETE CASCADE,
    UNIQUE (connection_uuid, table_name, name)
);

CREATE INDEX IF NOT EXISTS idx_saved_views_connection_table_updated
    ON saved_views(connection_uuid, table_name, updated_at DESC, id DESC);
