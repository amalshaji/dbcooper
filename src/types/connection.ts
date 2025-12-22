export type ConnectionType = "postgres" | "sqlite" | "redis" | "clickhouse";

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
	db_type: string;
	file_path?: string;
	ssh_enabled?: boolean;
	ssh_host?: string;
	ssh_port?: number;
	ssh_user?: string;
	ssh_password?: string;
	ssh_key_path?: string;
	ssh_use_key?: boolean;
};
