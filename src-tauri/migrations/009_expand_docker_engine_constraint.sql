CREATE TABLE docker_connections_new (
    connection_uuid TEXT PRIMARY KEY,
    ownership TEXT NOT NULL CHECK (ownership IN ('created', 'linked')),
    docker_context TEXT NOT NULL,
    container_id TEXT NOT NULL,
    container_name TEXT NOT NULL,
    engine TEXT NOT NULL CHECK (engine IN ('postgres', 'redis', 'clickhouse', 'mysql', 'mariadb')),
    image TEXT NOT NULL,
    internal_port INTEGER NOT NULL,
    compose_project TEXT,
    compose_service TEXT,
    volume_name TEXT,
    FOREIGN KEY (connection_uuid) REFERENCES connections(uuid) ON DELETE CASCADE
);

INSERT INTO docker_connections_new (
    connection_uuid,
    ownership,
    docker_context,
    container_id,
    container_name,
    engine,
    image,
    internal_port,
    compose_project,
    compose_service,
    volume_name
)
SELECT
    connection_uuid,
    ownership,
    docker_context,
    container_id,
    container_name,
    engine,
    image,
    internal_port,
    compose_project,
    compose_service,
    volume_name
FROM docker_connections;

DROP TABLE docker_connections;
ALTER TABLE docker_connections_new RENAME TO docker_connections;
