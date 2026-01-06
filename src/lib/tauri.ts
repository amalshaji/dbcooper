import { invoke } from "@tauri-apps/api/core";
import { isSqlFunction } from "@/lib/sqlFunctions";

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
	db_type: string;
	file_path: string | null;
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
	time_taken_ms?: number;
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

// Redis types
export interface RedisKeyInfo {
	key: string;
	key_type: string;
	ttl: number;
	size?: number;
}

export interface RedisKeyListResponse {
	keys: RedisKeyInfo[];
	total: number;
	time_taken_ms?: number;
	cursor: number;
	scan_complete: boolean;
}

export interface RedisKeyDetails {
	key: string;
	key_type: string;
	ttl: number;
	value: unknown;
	encoding?: string;
	size?: number;
	length?: number;
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
				db_type: connection.db_type || "postgres",
				host: connection.host,
				port: connection.port,
				database: connection.database,
				username: connection.username,
				password: connection.password,
				ssl: connection.ssl === 1,
				file_path: connection.file_path,
				ssh_enabled: connection.ssh_enabled === 1,
				ssh_host: connection.ssh_host,
				ssh_port: connection.ssh_port,
				ssh_user: connection.ssh_user,
				ssh_password: connection.ssh_password,
				ssh_key_path: connection.ssh_key_path,
				ssh_use_key: connection.ssh_use_key === 1,
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

		updateTableRow: (
			connection: Connection,
			schema: string,
			table: string,
			primaryKeyColumns: string[],
			primaryKeyValues: unknown[],
			updates:
				| Record<string, unknown>
				| Array<{
						column: string;
						value: unknown;
						isRawSql: boolean;
				  }>,
		) => {
			// Convert array format to map format for backward compatibility
			if (Array.isArray(updates)) {
				// Validate raw SQL values before sending to backend
				for (const update of updates) {
					if (update.isRawSql && typeof update.value === "string") {
						if (!isSqlFunction(update.value)) {
							throw new Error(
								`Invalid raw SQL value: "${update.value}". Only whitelisted SQL functions are allowed for security.`,
							);
						}
					}
				}

				return invoke<QueryResult>("update_table_row_with_raw_sql", {
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
					primaryKeyColumns,
					primaryKeyValues,
					updates: updates.map((u) => ({
						column: u.column,
						value: u.value,
						isRawSql: u.isRawSql,
					})),
				});
			}
			return invoke<QueryResult>("update_table_row", {
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
				primaryKeyColumns,
				primaryKeyValues,
				updates,
			});
		},

		deleteTableRow: (
			connection: Connection,
			schema: string,
			table: string,
			primaryKeyColumns: string[],
			primaryKeyValues: unknown[],
		) =>
			invoke<QueryResult>("delete_table_row", {
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
				primaryKeyColumns,
				primaryKeyValues,
			}),

		insertTableRow: (
			connection: Connection,
			schema: string,
			table: string,
			values: Array<{ column: string; value: unknown; isRawSql: boolean }>,
		) => {
			// Validate raw SQL values before sending to backend
			for (const value of values) {
				if (value.isRawSql && typeof value.value === "string") {
					if (!isSqlFunction(value.value)) {
						throw new Error(
							`Invalid raw SQL value: "${value.value}". Only whitelisted SQL functions are allowed for security.`,
						);
					}
				}
			}

			return invoke<QueryResult>("insert_table_row", {
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
				values: values.map((v) => ({
					column: v.column,
					value: v.value,
					isRawSql: v.isRawSql,
				})),
			});
		},
	},

	// Redis-specific API
	redis: {
		searchKeys: (
			connectionUuid: string,
			pattern: string,
			limit: number = 100,
			cursor: number = 0,
		) =>
			invoke<RedisKeyListResponse>("redis_search_keys", {
				uuid: connectionUuid,
				pattern,
				limit,
				cursor,
			}),

		getKeyDetails: (connectionUuid: string, key: string) =>
			invoke<RedisKeyDetails>("redis_get_key_details", {
				uuid: connectionUuid,
				key,
			}),

		deleteKey: (connectionUuid: string, key: string) =>
			invoke<boolean>("redis_delete_key", {
				uuid: connectionUuid,
				key,
			}),

		setKey: (
			connectionUuid: string,
			key: string,
			value: string,
			ttl?: number,
		) =>
			invoke<void>("redis_set_key", {
				uuid: connectionUuid,
				key,
				value,
				ttl,
			}),

		setListKey: (
			connectionUuid: string,
			key: string,
			values: string[],
			ttl?: number,
		) =>
			invoke<void>("redis_set_list_key", {
				uuid: connectionUuid,
				key,
				values,
				ttl,
			}),

		setSetKey: (
			connectionUuid: string,
			key: string,
			values: string[],
			ttl?: number,
		) =>
			invoke<void>("redis_set_set_key", {
				uuid: connectionUuid,
				key,
				values,
				ttl,
			}),

		setHashKey: (
			connectionUuid: string,
			key: string,
			fields: Record<string, string>,
			ttl?: number,
		) =>
			invoke<void>("redis_set_hash_key", {
				uuid: connectionUuid,
				key,
				fields,
				ttl,
			}),

		setZSetKey: (
			connectionUuid: string,
			key: string,
			members: Array<[string, number]>,
			ttl?: number,
		) =>
			invoke<void>("redis_set_zset_key", {
				uuid: connectionUuid,
				key,
				members,
				ttl,
			}),

		updateTTL: (
			connectionUuid: string,
			key: string,
			ttl?: number,
		) =>
			invoke<void>("redis_update_ttl", {
				uuid: connectionUuid,
				key,
				ttl,
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

	pool: {
		connect: (uuid: string) =>
			invoke<{ status: string; error?: string }>("pool_connect", { uuid }),

		disconnect: (uuid: string) => invoke<void>("pool_disconnect", { uuid }),

		getStatus: (uuid: string) =>
			invoke<{ status: string; error?: string }>("pool_get_status", { uuid }),

		healthCheck: (uuid: string) =>
			invoke<TestConnectionResult>("pool_health_check", { uuid }),

		listTables: (uuid: string) =>
			invoke<TableInfo[]>("pool_list_tables", { uuid }),

		getTableData: (
			uuid: string,
			schema: string,
			table: string,
			page: number,
			limit: number,
			filter?: string,
			sortColumn?: string,
			sortDirection?: "asc" | "desc",
		) =>
			invoke<TableDataResponse>("pool_get_table_data", {
				uuid,
				schema,
				table,
				page,
				limit,
				filter,
				sortColumn,
				sortDirection,
			}),

		getTableStructure: (uuid: string, schema: string, table: string) =>
			invoke<TableStructure>("pool_get_table_structure", {
				uuid,
				schema,
				table,
			}),

		executeQuery: (uuid: string, query: string) =>
			invoke<QueryResult>("pool_execute_query", { uuid, query }),

		getSchemaOverview: (uuid: string) =>
			invoke<{
				tables: {
					schema: string;
					name: string;
					type: string;
					columns: ColumnInfo[];
					foreign_keys: ForeignKeyInfo[];
					indexes: IndexInfo[];
				}[];
			}>("pool_get_schema_overview", { uuid }),

		updateTableRow: (
			uuid: string,
			schema: string,
			table: string,
			primaryKeyColumns: string[],
			primaryKeyValues: unknown[],
			updates: Array<{ column: string; value: unknown; isRawSql: boolean }>,
		) =>
			invoke<QueryResult>("pool_update_table_row", {
				uuid,
				schema,
				table,
				primaryKeyColumns,
				primaryKeyValues,
				updates,
			}),

		deleteTableRow: (
			uuid: string,
			schema: string,
			table: string,
			primaryKeyColumns: string[],
			primaryKeyValues: unknown[],
		) =>
			invoke<QueryResult>("pool_delete_table_row", {
				uuid,
				schema,
				table,
				primaryKeyColumns,
				primaryKeyValues,
			}),

		insertTableRow: (
			uuid: string,
			schema: string,
			table: string,
			values: Array<{ column: string; value: unknown; isRawSql: boolean }>,
		) =>
			invoke<QueryResult>("pool_insert_table_row", {
				uuid,
				schema,
				table,
				values,
			}),
	},

	ai: {
		selectTablesForQuery: (
			instruction: string,
			tables: { schema: string; name: string }[],
		) =>
			invoke<string[]>("select_tables_for_query", {
				instruction,
				tables,
			}),
	},
};
