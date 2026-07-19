export type DockerDatabaseEngine = "postgres" | "redis" | "clickhouse";

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
