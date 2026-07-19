export const DOCKER_DATABASE_ENGINES = [
	{
		value: "postgres",
		label: "PostgreSQL 17",
		defaultName: "Local PostgreSQL",
	},
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
