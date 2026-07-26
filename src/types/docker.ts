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
] as const;

export type DockerDatabaseEngine =
	(typeof DOCKER_DATABASE_ENGINES)[number]["value"];

export interface DockerContainerSummary {
	id: string;
	name: string;
	image: string;
	state: string;
	engine: DockerDatabaseEngine | null;
	compatible: boolean;
	possible_engines: DockerDatabaseEngine[];
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
