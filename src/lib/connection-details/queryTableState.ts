import type { SortConfig, Tab, TableColumn } from "@/types/tabTypes";

export function stripTrailingSemicolon(query: string): string {
	return query.trim().replace(/;\s*$/, "");
}

export function stripLeadingSqlComments(query: string): string {
	let sql = query.trimStart();

	while (true) {
		if (sql.startsWith("--")) {
			const newlineIndex = sql.indexOf("\n");
			if (newlineIndex === -1) return "";
			sql = sql.slice(newlineIndex + 1).trimStart();
			continue;
		}

		if (sql.startsWith("/*")) {
			const endIndex = sql.indexOf("*/");
			if (endIndex === -1) return "";
			sql = sql.slice(endIndex + 2).trimStart();
			continue;
		}

		break;
	}

	return sql;
}

export function isWrappableQuery(query: string): boolean {
	const sql = stripLeadingSqlComments(query).toUpperCase();
	return (
		sql.startsWith("SELECT") ||
		sql.startsWith("WITH") ||
		sql.startsWith("VALUES")
	);
}

export function quoteResultColumn(column: string, dbType?: string): string {
	const resolvedType = (dbType || "").toLowerCase();
	if (resolvedType === "clickhouse") {
		return `\`${column.replace(/`/g, "``")}\``;
	}
	return `"${column.replace(/"/g, '""')}"`;
}

export function buildWrappedQuery(
	baseQuery: string,
	filter: string,
	sort: SortConfig | null,
	dbType?: string,
): string {
	const normalizedBaseQuery = stripTrailingSemicolon(baseQuery);
	const trimmedFilter = filter.trim();
	const whereClause = trimmedFilter ? ` WHERE ${trimmedFilter}` : "";
	const orderClause = sort
		? ` ORDER BY ${quoteResultColumn(sort.column, dbType)} ${sort.direction.toUpperCase()}`
		: "";

	return `WITH user_query AS (
${normalizedBaseQuery}
)
SELECT * FROM user_query${whereClause}${orderClause};`;
}

export function getPrimaryKeyRowKey(
	row: Record<string, unknown>,
	columns: TableColumn[],
): string | null {
	const primaryKeyColumns = columns.filter((column) => column.primary_key);
	if (primaryKeyColumns.length === 0) return null;

	return JSON.stringify(
		primaryKeyColumns.map((column) => [column.name, row[column.name]]),
	);
}

export function areCellValuesEqual(left: unknown, right: unknown): boolean {
	return JSON.stringify(left) === JSON.stringify(right);
}

export function updateTabById<T extends Tab>(
	tabs: Tab[],
	id: string,
	updates: Partial<T>,
): Tab[] {
	return tabs.map((tab) => (tab.id === id ? { ...tab, ...updates } : tab));
}
