import type { TableColumn } from "@/types/tabTypes";
import type { ConnectionType } from "@/types/connection";

export type DbType = Exclude<ConnectionType, "redis">;

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
