export const DOCKER_DATABASE_ENGINES = [
	{
		value: "postgres",
		label: "PostgreSQL 17",
		defaultName: "Local PostgreSQL",
	},
	{ value: "mysql", label: "MySQL 8.4", defaultName: "Local MySQL" },
	{ value: "mariadb", label: "MariaDB 11.4", defaultName: "Local MariaDB" },
	{ value: "redis", label: "Redis 7", defaultName: "Local Redis" },
	{
		value: "clickhouse",
		label: "ClickHouse 25.8",
		defaultName: "Local ClickHouse",
	},
	{ value: "mongodb", label: "MongoDB 8.0", defaultName: "Local MongoDB" },
] as const;

export type DockerDatabaseEngine =
	(typeof DOCKER_DATABASE_ENGINES)[number]["value"];

export function isDockerDatabaseEngine(
	value: unknown,
): value is DockerDatabaseEngine {
	return DOCKER_DATABASE_ENGINES.some((engine) => engine.value === value);
}

export type DockerEngineDetection =
	| { status: "unsupported" }
	| { status: "detected"; engine: DockerDatabaseEngine }
	| {
			status: "ambiguous";
			engines: [DockerDatabaseEngine, DockerDatabaseEngine];
	  };

export interface DockerContainerSummary {
	id: string;
	name: string;
	image: string;
	state: string;
	detection: DockerEngineDetection;
}

export interface DockerConnectionDraft {
	container_id: string;
	container_name: string;
	image: string;
	engine: DockerDatabaseEngine;
	host: string;
	port: number;
	database: string;
	username: string;
	password: string;
	connection_uri: string | null;
	compose_project: string | null;
	compose_service: string | null;
}

export interface DockerConnectionState {
	connection_uuid: string;
	ownership: "created" | "linked";
	container_name: string;
	status: "running" | "stopped" | "missing" | "unavailable";
}

export interface DeleteConnectionResult {
	deleted: boolean;
	docker_cleanup_warning: string | null;
}
