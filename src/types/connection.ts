export type ConnectionType =
	| "postgres"
	| "mysql"
	| "mariadb"
	| "sqlite"
	| "duckdb"
	| "redis"
	| "clickhouse"
	| "d1"
	| "mongodb";

interface ConnectionBase {
	id: number;
	uuid: string;
	name: string;
	created_at: string;
	updated_at: string;
}

interface PersistedConnectionFields {
	host: string;
	port: number;
	database: string;
	username: string;
	password: string;
	ssl: number;
	file_path: string | null;
	ssh_enabled: number;
	ssh_host: string;
	ssh_port: number;
	ssh_user: string;
	ssh_password: string;
	ssh_key_path: string;
	ssh_use_key: number;
}

export type StandardConnectionType = Exclude<ConnectionType, "mongodb">;
export type SqlConnectionType = Exclude<StandardConnectionType, "redis">;

export interface StandardConnection
	extends ConnectionBase,
		PersistedConnectionFields {
	type: StandardConnectionType;
	db_type: StandardConnectionType;
	connection_uri?: null;
}

export interface MongoConnection
	extends ConnectionBase,
		PersistedConnectionFields {
	type: "mongodb";
	db_type: "mongodb";
	connection_uri: string;
}

export type Connection = StandardConnection | MongoConnection;

export type SqlConnection = Omit<StandardConnection, "type" | "db_type"> & {
	type: SqlConnectionType;
	db_type: SqlConnectionType;
};

export function isSqlConnection(
	connection: Connection,
): connection is SqlConnection {
	return connection.type !== "redis" && connection.type !== "mongodb";
}

export function isMongoConnection(
	connection: Connection,
): connection is MongoConnection {
	return connection.type === "mongodb";
}

export type ConnectionFormData = {
	type: ConnectionType;
	uuid?: string;
	name: string;
	host: string;
	port: number;
	database: string;
	username: string;
	password: string;
	ssl: boolean;
	file_path?: string;
	connection_uri?: string;
	ssh_enabled?: boolean;
	ssh_host?: string;
	ssh_port?: number;
	ssh_user?: string;
	ssh_password?: string;
	ssh_key_path?: string;
	ssh_use_key?: boolean;
};
