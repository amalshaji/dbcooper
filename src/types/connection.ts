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

export interface Connection {
	id: number;
	uuid: string;
	type: ConnectionType;
	name: string;
	host: string;
	port: number;
	database: string;
	username: string;
	password: string;
	ssl: number;
	db_type: ConnectionType;
	file_path: string | null;
	connection_uri?: string | null;
	ssh_enabled: number;
	ssh_host: string;
	ssh_port: number;
	ssh_user: string;
	ssh_password: string;
	ssh_key_path: string;
	ssh_use_key: number;
	created_at: string;
	updated_at: string;
}

export type SqlConnection = Omit<Connection, "type"> & {
	type: Exclude<ConnectionType, "redis" | "mongodb">;
};

export function isSqlConnection(
	connection: Connection,
): connection is SqlConnection {
	return connection.type !== "redis" && connection.type !== "mongodb";
}

export type MongoConnection = Omit<Connection, "type"> & {
	type: "mongodb";
};

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
	db_type: ConnectionType;
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
