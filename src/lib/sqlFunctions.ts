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
 * @param dbType - The database type (postgres, sqlite, clickhouse)
 * @param columnType - The column data type
 * @param columnName - Optional column name to check for patterns (e.g., "uuid" in name)
 */
export function getSuggestedFunctions(
	dbType: DbType,
	columnType: string,
	columnName?: string,
): string[] {
	const normalizedType = columnType.toLowerCase().trim();
	const normalizedName = columnName?.toLowerCase().trim() || "";

	const dbFunctions = SQL_FUNCTIONS[dbType];

	// Check if column name contains "uuid" OR type is uuid - return UUID functions if available
	// This check happens first to prioritize UUID functions when name/type suggests UUID
	if (dbFunctions?.uuid) {
		if (normalizedName.includes("uuid") || normalizedType === "uuid" || normalizedType.includes("uuid")) {
			return dbFunctions.uuid;
		}
	}

	// Check for exact match by type
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

const ALLOWED_SQL_VALUES: Set<string> = new Set([
	...SQL_FUNCTIONS.postgres.timestamp,
	...SQL_FUNCTIONS.postgres.timestamptz,
	...SQL_FUNCTIONS.postgres.date,
	...SQL_FUNCTIONS.postgres.time,
	...SQL_FUNCTIONS.postgres.uuid,
	...SQL_FUNCTIONS.postgres.serial,
	...SQL_FUNCTIONS.postgres.bigserial,
	...SQL_FUNCTIONS.postgres.boolean,
	...SQL_FUNCTIONS.postgres.bool,
	...SQL_FUNCTIONS.postgres.json,
	...SQL_FUNCTIONS.postgres.jsonb,
	...SQL_FUNCTIONS.sqlite.datetime,
	...SQL_FUNCTIONS.sqlite.timestamp,
	...SQL_FUNCTIONS.sqlite.date,
	...SQL_FUNCTIONS.sqlite.time,
	...SQL_FUNCTIONS.sqlite.integer,
	...SQL_FUNCTIONS.sqlite.boolean,
	...SQL_FUNCTIONS.sqlite.bool,
	...SQL_FUNCTIONS.clickhouse.datetime,
	...SQL_FUNCTIONS.clickhouse.datetime64,
	...SQL_FUNCTIONS.clickhouse.date,
	...SQL_FUNCTIONS.clickhouse.date32,
	...SQL_FUNCTIONS.clickhouse.uuid,
	...SQL_FUNCTIONS.clickhouse.bool,
	...SQL_FUNCTIONS.clickhouse.json,
]);

/**
 * Check if a value is an allowed SQL function/keyword from our known list.
 * This uses a strict allowlist to prevent arbitrary SQL injection.
 */
export function isSqlFunction(value: string): boolean {
	if (!value || typeof value !== "string") return false;
	return ALLOWED_SQL_VALUES.has(value.trim());
}
