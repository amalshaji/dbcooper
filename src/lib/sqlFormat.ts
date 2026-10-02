import { format } from "sql-formatter";
import { getSqlFormatterLanguage } from "./databaseCapabilities";

type SqlDbType = Parameters<typeof getSqlFormatterLanguage>[0];

export function formatSql(query: string, dbType: SqlDbType): string {
	return format(query, {
		language: getSqlFormatterLanguage(dbType),
		tabWidth: 2,
		keywordCase: "upper",
	});
}

/** Format for display, falling back to the original text if it can't be parsed. */
export function beautifySql(query: string, dbType: SqlDbType): string {
	try {
		return formatSql(query, dbType);
	} catch {
		return query;
	}
}
