import type { TableColumn } from "@/types/tabTypes";

export type DbType = "postgres" | "sqlite" | "clickhouse";

export interface FieldInputProps {
	column: TableColumn;
	value: unknown;
	isRawSql: boolean;
	isNull: boolean;
	suggestedFunctions: string[];
	dbType: DbType;
	onValueChange: (value: unknown, isRawSql: boolean) => void;
	isReadonly?: boolean;
}
