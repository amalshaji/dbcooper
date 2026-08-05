ALTER TABLE connections ADD COLUMN connection_uri TEXT;
ALTER TABLE saved_queries ADD COLUMN query_kind TEXT NOT NULL DEFAULT 'sql';
ALTER TABLE query_history ADD COLUMN query_kind TEXT NOT NULL DEFAULT 'sql';

CREATE TABLE docker_connections_new (
    connection_uuid TEXT PRIMARY KEY,
    ownership TEXT NOT NULL CHECK (ownership IN ('created', 'linked')),
    docker_context TEXT NOT NULL,
    container_id TEXT NOT NULL,
    container_name TEXT NOT NULL,
    engine TEXT NOT NULL,
    image TEXT NOT NULL,
    internal_port INTEGER NOT NULL,
    compose_project TEXT,
    compose_service TEXT,
    volume_name TEXT,
    FOREIGN KEY (connection_uuid) REFERENCES connections(uuid) ON DELETE CASCADE
);

INSERT INTO docker_connections_new SELECT * FROM docker_connections;
DROP TABLE docker_connections;
ALTER TABLE docker_connections_new RENAME TO docker_connections;
