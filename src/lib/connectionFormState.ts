import type { Connection, ConnectionFormData } from "@/types/connection";

export const DEFAULT_CONNECTION_FORM_DATA: ConnectionFormData = {
	type: "postgres",
	name: "",
	host: "localhost",
	port: 5432,
	database: "",
	username: "",
	password: "",
	ssl: false,
	file_path: undefined,
	connection_uri: "mongodb://localhost:27017/dbcooper",
	ssh_enabled: false,
	ssh_host: "",
	ssh_port: 22,
	ssh_user: "",
	ssh_password: "",
	ssh_key_path: "",
	ssh_use_key: false,
};

export function connectionToFormData(
	connection: Connection,
): ConnectionFormData {
	return {
		type: connection.type,
		name: connection.name,
		host: connection.host,
		port: connection.port,
		database: connection.database,
		username: connection.username,
		password: connection.password,
		ssl: connection.ssl === 1,
		file_path: connection.file_path ?? undefined,
		connection_uri:
			connection.connection_uri ??
			DEFAULT_CONNECTION_FORM_DATA.connection_uri,
		ssh_enabled: connection.ssh_enabled === 1,
		ssh_host: connection.ssh_host,
		ssh_port: connection.ssh_port,
		ssh_user: connection.ssh_user,
		ssh_password: connection.ssh_password,
		ssh_key_path: connection.ssh_key_path,
		ssh_use_key: connection.ssh_use_key === 1,
	};
}

interface D1ConnectionFieldChanges {
	accountId?: string;
	apiToken?: string;
	databaseId?: string;
}

export function mergeD1ConnectionFields(
	current: ConnectionFormData,
	changes: D1ConnectionFieldChanges,
): ConnectionFormData {
	return {
		...current,
		username: changes.accountId ?? current.username,
		password: changes.apiToken ?? current.password,
		database: changes.databaseId ?? current.database,
	};
}
