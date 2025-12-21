export type ConnectionType = "postgres" | "redis" | "clickhouse";

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
  ssl: boolean;
  created_at: string;
  updated_at: string;
}

export type ConnectionFormData = Omit<Connection, "id" | "created_at" | "updated_at">;
