import { getSuggestedFunctions } from "./sqlFunctions";
import type { CreateTableRequest } from "./tauri";

export type CreateTableDbType = "postgres" | "sqlite";
export type DefaultKind = "none" | "literal" | "expression";

export interface CreateTableColumnDraft {
	id: string;
	name: string;
	dataType: string;
	nullable: boolean;
	primaryKey: boolean;
	unique: boolean;
	defaultKind: DefaultKind;
	defaultValue: string;
}

export interface CreateTableDraft {
	schema: string;
	tableName: string;
	columns: CreateTableColumnDraft[];
}

export const CREATE_TABLE_TYPES: Record<CreateTableDbType, readonly string[]> = {
	postgres: [
		"SMALLINT",
		"INTEGER",
		"BIGINT",
		"SERIAL",
		"BIGSERIAL",
		"REAL",
		"DOUBLE PRECISION",
		"NUMERIC",
		"BOOLEAN",
		"TEXT",
		"VARCHAR",
		"DATE",
		"TIME",
		"TIMESTAMP",
		"TIMESTAMPTZ",
		"UUID",
		"JSON",
		"JSONB",
		"BYTEA",
	],
	sqlite: [
		"INTEGER",
		"REAL",
		"TEXT",
		"BLOB",
		"NUMERIC",
		"BOOLEAN",
		"DATE",
		"DATETIME",
	],
};

const NUMERIC_TYPES = new Set([
	"SMALLINT",
	"INTEGER",
	"BIGINT",
	"SERIAL",
	"BIGSERIAL",
	"REAL",
	"DOUBLE PRECISION",
	"NUMERIC",
]);

const IDENTIFIER_PATTERN = /^[a-z_][a-z0-9_]*$/;

export function createEmptyTableColumn(): CreateTableColumnDraft {
	return {
		id: crypto.randomUUID(),
		name: "",
		dataType: "TEXT",
		nullable: true,
		primaryKey: false,
		unique: false,
		defaultKind: "none",
		defaultValue: "",
	};
}

export function createInitialTableDraft(
	dbType: CreateTableDbType,
	initialSchema?: string,
): CreateTableDraft {
	return {
		schema: dbType === "sqlite" ? "main" : initialSchema || "public",
		tableName: "",
		columns: [createEmptyTableColumn()],
	};
}

export function getDefaultExpressions(
	dbType: CreateTableDbType,
	dataType: string,
): string[] {
	return getSuggestedFunctions(dbType, dataType).filter(
		(expression) => expression !== "DEFAULT" && expression !== "NULL",
	);
}

export function getCreateTableValidationError(
	draft: CreateTableDraft,
	dbType: CreateTableDbType,
): string | null {
	const schema = draft.schema.trim();
	const tableName = draft.tableName.trim();

	if (!schema) return "Schema name is required";
	if (!IDENTIFIER_PATTERN.test(schema)) {
		return "Schema name must use lowercase letters, numbers, and underscores";
	}
	if (dbType === "sqlite" && schema !== "main") {
		return "SQLite tables must be created in the main schema";
	}
	if (!tableName) return "Table name is required";
	if (!IDENTIFIER_PATTERN.test(tableName)) {
		return "Table name must use lowercase letters, numbers, and underscores";
	}
	if (draft.columns.length === 0) return "Add at least one column";

	const names = new Set<string>();
	for (const column of draft.columns) {
		const name = column.name.trim();
		const dataType = column.dataType.trim().toUpperCase();

		if (!name) return "Every column needs a name";
		if (!IDENTIFIER_PATTERN.test(name)) {
			return "Column names must use lowercase letters, numbers, and underscores";
		}
		if (names.has(name)) return "Column names must be unique";
		names.add(name);

		if (!CREATE_TABLE_TYPES[dbType].includes(dataType)) {
			return `Unsupported ${dbType === "postgres" ? "PostgreSQL" : "SQLite"} data type: ${column.dataType}`;
		}

		if (column.defaultKind === "literal" && NUMERIC_TYPES.has(dataType)) {
			if (
				column.defaultValue.trim() === "" ||
				!Number.isFinite(Number(column.defaultValue))
			) {
				return `Default for ${name} must be a number`;
			}
		}
		if (
			column.defaultKind === "literal" &&
			dataType === "BOOLEAN" &&
			!["true", "false"].includes(column.defaultValue.toLowerCase())
		) {
			return `Default for ${name} must be true or false`;
		}
		if (
			column.defaultKind === "expression" &&
			!getDefaultExpressions(dbType, dataType).includes(column.defaultValue)
		) {
			return `Choose a supported default expression for ${name}`;
		}
	}

	return null;
}

export function buildCreateTableRequest(
	draft: CreateTableDraft,
	dbType: CreateTableDbType,
): CreateTableRequest {
	const error = getCreateTableValidationError(draft, dbType);
	if (error) throw new Error(error);

	return {
		schema: draft.schema.trim(),
		name: draft.tableName.trim(),
		columns: draft.columns.map((column) => {
			const dataType = column.dataType.trim().toUpperCase();
			let defaultValue: CreateTableRequest["columns"][number]["default"] = null;

			if (column.defaultKind === "literal") {
				let value: string | number | boolean = column.defaultValue;
				if (NUMERIC_TYPES.has(dataType)) {
					value = Number(column.defaultValue);
				} else if (dataType === "BOOLEAN") {
					value = column.defaultValue.toLowerCase() === "true";
				}
				defaultValue = { kind: "literal", value };
			} else if (column.defaultKind === "expression") {
				defaultValue = {
					kind: "expression",
					value: column.defaultValue,
				};
			}

			return {
				name: column.name.trim(),
				data_type: dataType,
				nullable: column.primaryKey ? false : column.nullable,
				primary_key: column.primaryKey,
				unique: column.unique,
				default: defaultValue,
			};
		}),
	};
}
