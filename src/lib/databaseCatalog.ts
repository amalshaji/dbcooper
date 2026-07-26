import databaseCatalog from "../../src-tauri/database-catalog.json";
import type { ConnectionType } from "@/types/connection";

export type CreateTableDbType = Extract<
	ConnectionType,
	"postgres" | "sqlite"
>;
export type DatabaseValueType = ConnectionType;
export type LiteralKind = "text" | "number" | "boolean";
export type SqlFormatterLanguage = "postgresql" | "sqlite" | "duckdb" | "sql";

interface DatabasePolicy {
	label: string;
	defaultSchema: string;
	fileDatabase: boolean;
	structuredRowMutations: boolean;
	formatterLanguage: SqlFormatterLanguage;
	createTableTypes: string[];
	literalKinds: Record<string, LiteralKind>;
	expressionsByType: Record<string, string[]>;
}

const catalog = databaseCatalog as Record<DatabaseValueType, DatabasePolicy>;

export function getDatabasePolicy(dbType: ConnectionType): DatabasePolicy {
	return catalog[dbType];
}

export function getCreateTableDbType(
	dbType: ConnectionType | undefined,
): CreateTableDbType | null {
	return dbType === "postgres" || dbType === "sqlite" ? dbType : null;
}

export function getDatabaseLabel(dbType: DatabaseValueType): string {
	return getDatabasePolicy(dbType).label;
}

export function getDefaultSchema(dbType: CreateTableDbType): string {
	return catalog[dbType].defaultSchema;
}

export function getCreateTableTypes(
	dbType: CreateTableDbType,
): readonly string[] {
	return catalog[dbType].createTableTypes;
}

export function getLiteralKind(
	dbType: CreateTableDbType,
	dataType: string,
): LiteralKind {
	return (
		catalog[dbType].literalKinds[dataType.trim().toUpperCase()] || "text"
	);
}

export function getSuggestedFunctions(
	dbType: DatabaseValueType,
	columnType: string,
	columnName?: string,
): string[] {
	const normalizedType = columnType.trim().toUpperCase();
	const normalizedName = columnName?.trim().toLowerCase() || "";
	const expressionsByType = catalog[dbType].expressionsByType;

	if (
		expressionsByType.UUID &&
		(normalizedName.includes("uuid") || normalizedType.includes("UUID"))
	) {
		return expressionsByType.UUID;
	}

	if (expressionsByType[normalizedType]) {
		return expressionsByType[normalizedType];
	}

	for (const [dataType, expressions] of Object.entries(expressionsByType)) {
		if (
			normalizedType.includes(dataType) ||
			dataType.includes(normalizedType)
		) {
			return expressions;
		}
	}

	return [];
}

export function isSqlFunction(
	value: string,
	dbType: ConnectionType,
): boolean {
	if (!value || dbType === "redis") return false;
	const normalizedValue = value.trim().toLowerCase();

	return Object.values(catalog[dbType].expressionsByType)
		.flat()
		.some((candidate) => candidate.toLowerCase() === normalizedValue);
}
