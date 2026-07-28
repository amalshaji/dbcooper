import {
	getCreateTableTypes,
	getCreateTableModifierCapabilities,
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

export interface MysqlColumnModifiersDraft {
	length: string;
	precision: string;
	scale: string;
	unsigned: boolean;
	autoIncrement: boolean;
}

export interface CreateTableColumnDraft {
	id: string;
	name: string;
	dataType: string;
	nullable: boolean;
	primaryKey: boolean;
	unique: boolean;
	default: CreateTableColumnDefaultDraft;
	mysqlModifiers: MysqlColumnModifiersDraft | null;
}

export interface CreateTableDraft {
	schema: string;
	tableName: string;
	columns: CreateTableColumnDraft[];
}

const IDENTIFIER_PATTERN = /^[a-z_][a-z0-9_]*$/;

export function createEmptyTableColumn(
	dbType: CreateTableDbType,
): CreateTableColumnDraft {
	return {
		id: crypto.randomUUID(),
		name: "",
		dataType: "TEXT",
		nullable: true,
		primaryKey: false,
		unique: false,
		default: { kind: "none" },
		mysqlModifiers:
			dbType === "mysql" || dbType === "mariadb"
				? {
						length: "",
						precision: "",
						scale: "",
						unsigned: false,
						autoIncrement: false,
					}
				: null,
	};
}

export function createInitialTableDraft(
	dbType: CreateTableDbType,
	initialSchema?: string,
): CreateTableDraft {
	return {
		schema:
			dbType === "sqlite" || dbType === "d1"
				? getDefaultSchema(dbType)
				: initialSchema || getDefaultSchema(dbType),
		tableName: "",
		columns: [createEmptyTableColumn(dbType)],
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
	if ((dbType === "sqlite" || dbType === "d1") && schema !== "main") {
		return `${getDatabaseLabel(dbType)} tables must be created in the main schema`;
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

		const modifiers = column.mysqlModifiers;
		const capabilities = getCreateTableModifierCapabilities(dbType);
		if (modifiers && dbType !== "mysql" && dbType !== "mariadb") {
			return `MySQL modifiers are not supported for ${name}`;
		}
		if (modifiers?.length && (!capabilities.lengthTypes.includes(dataType) || !/^\d+$/.test(modifiers.length) || Number(modifiers.length) < 1)) {
			return `Length is not supported for ${name}`;
		}
		if (modifiers?.precision || modifiers?.scale) {
			const precisionValue = modifiers.precision || "";
			const scaleValue = modifiers.scale || "";
			const precision = Number(precisionValue);
			const scale = scaleValue ? Number(scaleValue) : 0;
			if (!capabilities.decimalTypes.includes(dataType) || !/^\d+$/.test(precisionValue) || (scaleValue && !/^\d+$/.test(scaleValue)) || precision < 1 || precision > 65 || scale > 30 || scale > precision) {
				return `Decimal precision or scale is invalid for ${name}`;
			}
		}
		if (modifiers?.unsigned && !capabilities.unsignedTypes.includes(dataType)) {
			return `Unsigned is not supported for ${name}`;
		}
		if (modifiers?.autoIncrement && (!capabilities.autoIncrementTypes.includes(dataType) || !column.primaryKey)) {
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

			const mysqlModifiers = column.mysqlModifiers
					? {
							length: column.mysqlModifiers.length ? Number(column.mysqlModifiers.length) : null,
							precision: column.mysqlModifiers.precision ? Number(column.mysqlModifiers.precision) : null,
							scale: column.mysqlModifiers.scale ? Number(column.mysqlModifiers.scale) : null,
							unsigned: column.mysqlModifiers.unsigned,
							auto_increment: column.mysqlModifiers.autoIncrement,
						}
					: undefined;

			return {
				name: column.name.trim(),
				data_type: dataType,
				nullable: column.primaryKey ? false : column.nullable,
				primary_key: column.primaryKey,
				unique: column.unique,
				default: defaultValue,
				...(mysqlModifiers ? { mysql_modifiers: mysqlModifiers } : {}),
			};
		}),
	};
}
