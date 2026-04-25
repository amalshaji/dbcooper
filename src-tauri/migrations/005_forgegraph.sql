CREATE TABLE forgegraph_services (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    app_slug TEXT NOT NULL,
    app_name TEXT NOT NULL,
    stage TEXT NOT NULL,
    kind TEXT NOT NULL,
    node_name TEXT NOT NULL,
    node_status TEXT NOT NULL DEFAULT 'online',
    config TEXT,
    transports TEXT,
    synced_at TEXT NOT NULL DEFAULT (datetime('now')),
    UNIQUE(app_slug, stage, kind)
);
