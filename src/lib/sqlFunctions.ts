type DbType = "postgres" | "sqlite" | "clickhouse";

const SQL_FUNCTIONS: Record<DbType, Record<string, string[]>> = {
	postgres: {
		timestamp: ["now()", "current_timestamp", "localtimestamp"],
		timestamptz: ["now()", "current_timestamp"],
		date: ["current_date", "now()::date"],
		time: ["current_time", "localtime"],
		uuid: ["gen_random_uuid()", "uuid_generate_v4()"],
		serial: ["DEFAULT"],
		bigserial: ["DEFAULT"],
		boolean: ["TRUE", "FALSE"],
		bool: ["TRUE", "FALSE"],
		json: ["'{}'::json", "'[]'::json"],
		jsonb: ["'{}'::jsonb", "'[]'::jsonb"],
	},
	sqlite: {
		datetime: ["datetime('now')", "datetime('now', 'localtime')"],
		timestamp: ["datetime('now')", "datetime('now', 'localtime')"],
		date: ["date('now')", "date('now', 'localtime')"],
		time: ["time('now')", "time('now', 'localtime')"],
		integer: ["NULL"],
		boolean: ["1", "0"],
		bool: ["1", "0"],
	},
	clickhouse: {
		datetime: ["now()", "now64()", "today()"],
		datetime64: ["now()", "now64()", "today()"],
		date: ["today()", "yesterday()"],
		date32: ["today()", "yesterday()"],
		uuid: ["generateUUIDv4()"],
		bool: ["true", "false"],
		json: ["'{}'"],
	},
};

/**
 * Get suggested SQL functions for a given database type and column type
 */
export function getSuggestedFunctions(
	dbType: DbType,
	columnType: string,
): string[] {
	const normalizedType = columnType.toLowerCase().trim();

	// Check for exact match
	const dbFunctions = SQL_FUNCTIONS[dbType];
	if (dbFunctions[normalizedType]) {
		return dbFunctions[normalizedType];
	}

	// Check for partial matches (e.g., "timestamp without time zone" contains "timestamp")
	for (const [key, functions] of Object.entries(dbFunctions)) {
		if (normalizedType.includes(key) || key.includes(normalizedType)) {
			return functions;
		}
	}

	return [];
}

/**
 * Check if a value looks like a SQL function call
 */
export function isSqlFunction(value: string): boolean {
	if (!value || typeof value !== "string") return false;
	const trimmed = value.trim();
	// Check if it ends with () or matches common function patterns
	return (
		trimmed.endsWith("()") ||
		trimmed.match(/^[a-zA-Z_][a-zA-Z0-9_]*\s*\(/i) !== null ||
		trimmed === "TRUE" ||
		trimmed === "FALSE" ||
		trimmed === "DEFAULT" ||
		trimmed === "NULL" ||
		trimmed === "true" ||
		trimmed === "false" ||
		trimmed === "1" ||
		trimmed === "0"
	);
}
