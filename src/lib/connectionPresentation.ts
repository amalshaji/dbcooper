import type { ConnectionType } from "@/types/connection";

export function getConnectionDatabaseDisplay(connection: {
	type: ConnectionType;
	database: string;
}): string {
	return connection.type === "d1" ? "Cloudflare D1" : connection.database;
}
