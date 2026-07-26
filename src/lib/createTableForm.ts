import {
	getCreateTableTypes,
	getDatabaseLabel,
	getDefaultSchema,
	getLiteralKind,
	getSuggestedFunctions,
	type CreateTableDbType,
} from "./databaseCatalog";
import type { CreateTableRequest } from "./tauri";

export type DefaultKind = "none" | "literal" | "expression";
export type { CreateTableDbType } from "./databaseCatalog";

export type CreateTableColumnDefaultDraft =
	| { kind: "none" }
	| { kind: "literal"; value: string }
	| { kind: "expression"; value: string };

export interface CreateTableColumnDraft {
	id: string;
	name: string;
	dataType: string;
	nullable: boolean;
	primaryKey: boolean;
	unique: boolean;
	default: CreateTableColumnDefaultDraft;
	length?: string;
	precision?: string;
	scale?: string;
	unsigned?: boolean;
	autoIncrement?: boolean;
}

export interface CreateTableDraft {
	schema: string;
	tableName: string;
	columns: CreateTableColumnDraft[];
}

const IDENTIFIER_PATTERN = /^[a-z_][a-z0-9_]*$/;

export function createEmptyTableColumn(): CreateTableColumnDraft {
	return {
		id: crypto.randomUUID(),
		name: "",
		dataType: "TEXT",
		nullable: true,
		primaryKey: false,
		unique: false,
		default: { kind: "none" },
		length: "",
		precision: "",
		scale: "",
		unsigned: false,
		autoIncrement: false,
	};
}

export function createInitialTableDraft(
	dbType: CreateTableDbType,
	initialSchema?: string,
): CreateTableDraft {
	return {
		schema:
			dbType === "sqlite"
				? getDefaultSchema(dbType)
				: initialSchema || getDefaultSchema(dbType),
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

		if (!getCreateTableTypes(dbType).includes(dataType)) {
			return `Unsupported ${getDatabaseLabel(dbType)} data type: ${column.dataType}`;
		}

		const mysqlFamily = dbType === "mysql" || dbType === "mariadb";
		const lengthTypes = ["CHAR", "VARCHAR", "BINARY", "VARBINARY"];
		const decimalTypes = ["DECIMAL", "NUMERIC"];
		const integerTypes = ["TINYINT", "SMALLINT", "MEDIUMINT", "INT", "INTEGER", "BIGINT"];
		const unsignedTypes = [...integerTypes, ...decimalTypes, "FLOAT", "DOUBLE"];
		if (column.length && (!mysqlFamily || !lengthTypes.includes(dataType) || !/^\d+$/.test(column.length) || Number(column.length) < 1)) {
			return `Length is not supported for ${name}`;
		}
		if (column.precision || column.scale) {
			const precisionValue = column.precision || "";
			const scaleValue = column.scale || "";
			const precision = Number(precisionValue);
			const scale = scaleValue ? Number(scaleValue) : 0;
			if (!mysqlFamily || !decimalTypes.includes(dataType) || !/^\d+$/.test(precisionValue) || (scaleValue && !/^\d+$/.test(scaleValue)) || precision < 1 || precision > 65 || scale > 30 || scale > precision) {
				return `Decimal precision or scale is invalid for ${name}`;
			}
		}
		if (column.unsigned && (!mysqlFamily || !unsignedTypes.includes(dataType))) {
			return `Unsigned is not supported for ${name}`;
		}
		if (column.autoIncrement && (!mysqlFamily || !integerTypes.includes(dataType) || !column.primaryKey)) {
			return `Auto increment requires an integer primary key for ${name}`;
		}

		const literalKind = getLiteralKind(dbType, dataType);
		if (column.default.kind === "literal" && literalKind === "number") {
			if (
				column.default.value.trim() === "" ||
				!Number.isFinite(Number(column.default.value))
			) {
				return `Default for ${name} must be a number`;
			}
		}
		if (
			column.default.kind === "literal" &&
			literalKind === "boolean" &&
			!["true", "false"].includes(column.default.value.toLowerCase())
		) {
			return `Default for ${name} must be true or false`;
		}
		if (
			column.default.kind === "expression" &&
			!getDefaultExpressions(dbType, dataType).includes(column.default.value)
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

			if (column.default.kind === "literal") {
				let value: string | number | boolean = column.default.value;
				const literalKind = getLiteralKind(dbType, dataType);
				if (literalKind === "number") {
					value = Number(column.default.value);
				} else if (literalKind === "boolean") {
					value = column.default.value.toLowerCase() === "true";
				}
				defaultValue = { kind: "literal", value };
			} else if (column.default.kind === "expression") {
				defaultValue = {
					kind: "expression",
					value: column.default.value,
				};
			}

			const mysqlModifiers =
				dbType === "mysql" || dbType === "mariadb"
					? {
							length: column.length ? Number(column.length) : null,
							precision: column.precision ? Number(column.precision) : null,
							scale: column.scale ? Number(column.scale) : null,
							unsigned: Boolean(column.unsigned),
							auto_increment: Boolean(column.autoIncrement),
						}
					: {};

			return {
				name: column.name.trim(),
				data_type: dataType,
				nullable: column.primaryKey ? false : column.nullable,
				primary_key: column.primaryKey,
				unique: column.unique,
				default: defaultValue,
				...mysqlModifiers,
			};
		}),
	};
}
