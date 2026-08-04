import type { Connection, ConnectionType } from "@/types/connection";

export type ConnectionWorkspace = "sql" | "key-value" | "document";
export type ConnectionFormKind = "server" | "file" | "d1" | "uri";
export type ConnectionTestStrategy = "postgres" | "unified" | "mongo";

export interface ConnectionCapabilities {
	label: string;
	workspace: ConnectionWorkspace;
	form: ConnectionFormKind;
	loadsSchema: boolean;
	fileDatabase: boolean;
	structuredRowMutations: boolean;
	defaultPort: number;
	testStrategy: ConnectionTestStrategy;
}

const CAPABILITIES: Record<ConnectionType, ConnectionCapabilities> = {
	postgres: {
		label: "PostgreSQL",
		workspace: "sql",
		form: "server",
		loadsSchema: true,
		fileDatabase: false,
		structuredRowMutations: true,
		defaultPort: 5432,
		testStrategy: "postgres",
	},
	mysql: {
		label: "MySQL",
		workspace: "sql",
		form: "server",
		loadsSchema: true,
		fileDatabase: false,
		structuredRowMutations: true,
		defaultPort: 3306,
		testStrategy: "unified",
	},
	mariadb: {
		label: "MariaDB",
		workspace: "sql",
		form: "server",
		loadsSchema: true,
		fileDatabase: false,
		structuredRowMutations: true,
		defaultPort: 3306,
		testStrategy: "unified",
	},
	sqlite: {
		label: "SQLite",
		workspace: "sql",
		form: "file",
		loadsSchema: true,
		fileDatabase: true,
		structuredRowMutations: true,
		defaultPort: 0,
		testStrategy: "unified",
	},
	duckdb: {
		label: "DuckDB",
		workspace: "sql",
		form: "file",
		loadsSchema: true,
		fileDatabase: true,
		structuredRowMutations: false,
		defaultPort: 0,
		testStrategy: "unified",
	},
	redis: {
		label: "Redis",
		workspace: "key-value",
		form: "server",
		loadsSchema: false,
		fileDatabase: false,
		structuredRowMutations: false,
		defaultPort: 6379,
		testStrategy: "unified",
	},
	clickhouse: {
		label: "ClickHouse",
		workspace: "sql",
		form: "server",
		loadsSchema: true,
		fileDatabase: false,
		structuredRowMutations: false,
		defaultPort: 9000,
		testStrategy: "unified",
	},
	d1: {
		label: "Cloudflare D1",
		workspace: "sql",
		form: "d1",
		loadsSchema: true,
		fileDatabase: false,
		structuredRowMutations: true,
		defaultPort: 443,
		testStrategy: "unified",
	},
	mongodb: {
		label: "MongoDB",
		workspace: "document",
		form: "uri",
		loadsSchema: false,
		fileDatabase: false,
		structuredRowMutations: false,
		defaultPort: 27017,
		testStrategy: "mongo",
	},
};

export const CONNECTION_TYPES = Object.keys(CAPABILITIES) as ConnectionType[];

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
