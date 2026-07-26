import type { ConnectionType } from "@/types/connection";

export function isFileDatabase(dbType: ConnectionType): boolean {
	return dbType === "sqlite" || dbType === "duckdb";
}

export function supportsStructuredRowMutations(
	dbType: ConnectionType,
): boolean {
	return dbType === "postgres" || dbType === "sqlite";
}

export function getSqlFormatterLanguage(
	dbType: ConnectionType,
): "postgresql" | "sqlite" | "duckdb" | "sql" {
	switch (dbType) {
		case "sqlite":
			return "sqlite";
		case "duckdb":
			return "duckdb";
		case "clickhouse":
		case "redis":
			return "sql";
		default:
			return "postgresql";
	}
}
