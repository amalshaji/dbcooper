-- Create query_history table (rolling last-10 runs per connection)
CREATE TABLE IF NOT EXISTS query_history (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    connection_uuid TEXT NOT NULL,
    query TEXT NOT NULL,
    status TEXT NOT NULL,              -- 'success' | 'error'
    time_taken_ms INTEGER,
    row_count INTEGER,
    rows_affected INTEGER,
    error TEXT,
    executed_at TEXT NOT NULL DEFAULT (datetime('now')),
    FOREIGN KEY (connection_uuid) REFERENCES connections(uuid) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_query_history_conn
    ON query_history(connection_uuid, executed_at DESC);
