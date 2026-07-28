import type { Connection, ConnectionType } from "@/types/connection";

export type ConnectionWorkspace = "sql" | "key-value" | "document";
export type ConnectionFormKind = "server" | "file" | "d1" | "uri";

export interface ConnectionCapabilities {
	workspace: ConnectionWorkspace;
	form: ConnectionFormKind;
	loadsSchema: boolean;
	fileDatabase: boolean;
	structuredRowMutations: boolean;
	defaultPort: number;
}

const CAPABILITIES: Record<ConnectionType, ConnectionCapabilities> = {
	postgres: {
		workspace: "sql",
		form: "server",
		loadsSchema: true,
		fileDatabase: false,
		structuredRowMutations: true,
		defaultPort: 5432,
	},
	mysql: {
		workspace: "sql",
		form: "server",
		loadsSchema: true,
		fileDatabase: false,
		structuredRowMutations: true,
		defaultPort: 3306,
	},
	mariadb: {
		workspace: "sql",
		form: "server",
		loadsSchema: true,
		fileDatabase: false,
		structuredRowMutations: true,
		defaultPort: 3306,
	},
	sqlite: {
		workspace: "sql",
		form: "file",
		loadsSchema: true,
		fileDatabase: true,
		structuredRowMutations: true,
		defaultPort: 0,
	},
	duckdb: {
		workspace: "sql",
		form: "file",
		loadsSchema: true,
		fileDatabase: true,
		structuredRowMutations: false,
		defaultPort: 0,
	},
	redis: {
		workspace: "key-value",
		form: "server",
		loadsSchema: false,
		fileDatabase: false,
		structuredRowMutations: false,
		defaultPort: 6379,
	},
	clickhouse: {
		workspace: "sql",
		form: "server",
		loadsSchema: true,
		fileDatabase: false,
		structuredRowMutations: false,
		defaultPort: 9000,
	},
	d1: {
		workspace: "sql",
		form: "d1",
		loadsSchema: true,
		fileDatabase: false,
		structuredRowMutations: true,
		defaultPort: 443,
	},
	mongodb: {
		workspace: "document",
		form: "uri",
		loadsSchema: false,
		fileDatabase: false,
		structuredRowMutations: false,
		defaultPort: 27017,
	},
};

export function getConnectionCapabilities(
	type: ConnectionType,
): ConnectionCapabilities {
	return CAPABILITIES[type];
}

export function getConnectionDisplayEndpoint(connection: Connection): string {
	if (connection.type !== "mongodb") {
		return connection.file_path || `${connection.host}:${connection.port}`;
	}

	try {
		const uri = new URL(connection.connection_uri);
		return `${uri.hostname}${uri.pathname === "/" ? "" : uri.pathname}`;
	} catch {
		return "MongoDB";
	}
}
