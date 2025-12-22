import { invoke } from "@tauri-apps/api/core";

export interface Connection {
	id: number;
	uuid: string;
	type: string;
	name: string;
	host: string;
	port: number;
	database: string;
	username: string;
	password: string;
	ssl: number;
	dbType: string;
	filePath: string | null;
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

export interface ConnectionFormData {
	type: string;
	uuid?: string;
	name: string;
	host: string;
	port: number;
	database: string;
	username: string;
	password: string;
	ssl: boolean;
	dbType: string;
	file_path?: string;
	ssh_enabled?: boolean;
	ssh_host?: string;
	ssh_port?: number;
	ssh_user?: string;
	ssh_password?: string;
	ssh_key_path?: string;
	ssh_use_key?: boolean;
}

export interface TableInfo {
	schema: string;
	name: string;
	type: string;
}

export interface ColumnInfo {
	name: string;
	type: string;
	nullable: boolean;
	default: string | null;
	primary_key: boolean;
}

export interface IndexInfo {
	name: string;
	columns: string[];
	unique: boolean;
	primary: boolean;
}

export interface ForeignKeyInfo {
	name: string;
	column: string;
	references_table: string;
	references_column: string;
}

export interface TableStructure {
	columns: ColumnInfo[];
	indexes: IndexInfo[];
	foreign_keys: ForeignKeyInfo[];
}

export interface TableDataResponse {
	data: Record<string, unknown>[];
	total: number;
	page: number;
	limit: number;
}

export interface QueryResult {
	data: Record<string, unknown>[];
	row_count: number;
	error?: string;
}

export interface TestConnectionResult {
	success: boolean;
	message: string;
}

export interface SavedQuery {
	id: number;
	connection_uuid: string;
	name: string;
	query: string;
	created_at: string;
	updated_at: string;
}

export interface SavedQueryFormData {
	name: string;
	query: string;
}

export const api = {
	connections: {
		list: () => invoke<Connection[]>("get_connections"),

		getByUuid: (uuid: string) =>
			invoke<Connection>("get_connection_by_uuid", { uuid }),

		create: (data: ConnectionFormData) =>
			invoke<Connection>("create_connection", { data }),

		update: (id: number, data: ConnectionFormData) =>
			invoke<Connection>("update_connection", { id, data }),

		delete: (id: number) => invoke<boolean>("delete_connection", { id }),
	},

	postgres: {
		testConnection: (params: {
			host: string;
			port: number;
			database: string;
			username: string;
			password: string;
			ssl: boolean;
			ssh_enabled?: boolean;
			ssh_host?: string;
			ssh_port?: number;
			ssh_user?: string;
			ssh_password?: string;
			ssh_key_path?: string;
			ssh_use_key?: boolean;
		}) => invoke<TestConnectionResult>("test_connection", params),

		listTables: (connection: Connection) =>
			invoke<TableInfo[]>("list_tables", {
				host: connection.host,
				port: connection.port,
				database: connection.database,
				username: connection.username,
				password: connection.password,
				ssl: connection.ssl === 1,
			}),

		getTableData: (
			connection: Connection,
			schema: string,
			table: string,
			page: number,
			limit: number,
			filter?: string,
		) =>
			invoke<TableDataResponse>("get_table_data", {
				host: connection.host,
				port: connection.port,
				database: connection.database,
				username: connection.username,
				password: connection.password,
				ssl: connection.ssl === 1,
				schema,
				table,
				page,
				limit,
				filter,
			}),

		getTableStructure: (
			connection: Connection,
			schema: string,
			table: string,
		) =>
			invoke<TableStructure>("get_table_structure", {
				host: connection.host,
				port: connection.port,
				database: connection.database,
				username: connection.username,
				password: connection.password,
				ssl: connection.ssl === 1,
				schema,
				table,
			}),

		executeQuery: (connection: Connection, query: string) =>
			invoke<QueryResult>("execute_query", {
				host: connection.host,
				port: connection.port,
				database: connection.database,
				username: connection.username,
				password: connection.password,
				ssl: connection.ssl === 1,
				query,
			}),
	},

	// Unified database API that works with both Postgres and SQLite
	database: {
		testConnection: (connection: Connection) =>
			invoke<TestConnectionResult>("unified_test_connection", {
				dbType: connection.db_type || "postgres",
				host: connection.host,
				port: connection.port,
				database: connection.database,
				username: connection.username,
				password: connection.password,
				ssl: connection.ssl === 1,
				filePath: connection.file_path,
			}),

		listTables: (connection: Connection) =>
			invoke<TableInfo[]>("unified_list_tables", {
				dbType: connection.db_type || "postgres",
				host: connection.host,
				port: connection.port,
				database: connection.database,
				username: connection.username,
				password: connection.password,
				ssl: connection.ssl === 1,
				filePath: connection.file_path,
			}),

		getTableData: (
			connection: Connection,
			schema: string,
			table: string,
			page: number,
			limit: number,
			filter?: string,
		) =>
			invoke<TableDataResponse>("unified_get_table_data", {
				dbType: connection.db_type || "postgres",
				host: connection.host,
				port: connection.port,
				database: connection.database,
				username: connection.username,
				password: connection.password,
				ssl: connection.ssl === 1,
				filePath: connection.file_path,
				schema,
				table,
				page,
				limit,
				filter,
			}),

		getTableStructure: (
			connection: Connection,
			schema: string,
			table: string,
		) =>
			invoke<TableStructure>("unified_get_table_structure", {
				dbType: connection.db_type || "postgres",
				host: connection.host,
				port: connection.port,
				database: connection.database,
				username: connection.username,
				password: connection.password,
				ssl: connection.ssl === 1,
				filePath: connection.file_path,
				schema,
				table,
			}),

		executeQuery: (connection: Connection, query: string) =>
			invoke<QueryResult>("unified_execute_query", {
				dbType: connection.db_type || "postgres",
				host: connection.host,
				port: connection.port,
				database: connection.database,
				username: connection.username,
				password: connection.password,
				ssl: connection.ssl === 1,
				filePath: connection.file_path,
				query,
			}),
	},

	queries: {
		list: (connectionUuid: string) =>
			invoke<SavedQuery[]>("get_saved_queries", { connectionUuid }),

		create: (connectionUuid: string, data: SavedQueryFormData) =>
			invoke<SavedQuery>("create_saved_query", { connectionUuid, data }),

		update: (id: number, data: SavedQueryFormData) =>
			invoke<SavedQuery>("update_saved_query", { id, data }),

		delete: (id: number) => invoke<boolean>("delete_saved_query", { id }),
	},

	settings: {
		get: (key: string) => invoke<string | null>("get_setting", { key }),

		set: (key: string, value: string) =>
			invoke<void>("set_setting", { key, value }),

		getAll: () => invoke<Record<string, string>>("get_all_settings"),
	},
};
