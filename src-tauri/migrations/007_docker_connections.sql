CREATE TABLE docker_connections (
    connection_uuid TEXT PRIMARY KEY,
    ownership TEXT NOT NULL CHECK (ownership IN ('created', 'linked')),
    docker_context TEXT NOT NULL,
    container_id TEXT NOT NULL,
    container_name TEXT NOT NULL,
    engine TEXT NOT NULL CHECK (engine IN ('postgres', 'redis', 'clickhouse')),
    image TEXT NOT NULL,
    internal_port INTEGER NOT NULL,
    compose_project TEXT,
    compose_service TEXT,
    volume_name TEXT,
    FOREIGN KEY (connection_uuid) REFERENCES connections(uuid) ON DELETE CASCADE
);
