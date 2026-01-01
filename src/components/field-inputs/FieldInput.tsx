import type { TableColumn } from "@/types/tabTypes";
import { getSuggestedFunctions } from "@/lib/sqlFunctions";
import { BooleanFieldInput } from "./BooleanFieldInput";
import { JsonFieldInput } from "./JsonFieldInput";
import { TextFieldInput } from "./TextFieldInput";
import { NumericFieldInput } from "./NumericFieldInput";
import { TimestampFieldInput } from "./TimestampFieldInput";
import { UuidFieldInput } from "./UuidFieldInput";
import { DefaultFieldInput } from "./DefaultFieldInput";
import type { DbType } from "./types";

interface FieldInputDispatcherProps {
	column: TableColumn;
	value: unknown;
	isRawSql: boolean;
	dbType: DbType;
	onValueChange: (columnName: string, value: unknown, isRawSql: boolean) => void;
	isReadonly?: boolean;
}

function isNumericType(columnType: string): boolean {
	return (
		columnType.includes("int") ||
		columnType.includes("numeric") ||
		columnType.includes("decimal") ||
		columnType.includes("real") ||
		columnType.includes("double") ||
		columnType.includes("float") ||
		columnType === "serial" ||
		columnType === "bigserial"
	);
}

function isTimestampType(columnType: string): boolean {
	return (
		columnType.includes("timestamp") ||
		columnType === "date" ||
		columnType === "time"
	);
}

export function FieldInput({
	column,
	value,
	isRawSql,
	dbType,
	onValueChange,
	isReadonly = false,
}: FieldInputDispatcherProps) {
	const columnType = column.type.toLowerCase();
	const isNull = value === null || value === "";
	const suggestedFunctions = getSuggestedFunctions(dbType, columnType, column.name);

	const handleValueChange = (newValue: unknown, newIsRawSql: boolean) => {
		onValueChange(column.name, newValue, newIsRawSql);
	};

	const commonProps = {
		column,
		value,
		isRawSql,
		isNull,
		suggestedFunctions,
		dbType,
		onValueChange: handleValueChange,
		isReadonly,
	};

	if (columnType === "boolean" || columnType === "bool") {
		return <BooleanFieldInput {...commonProps} />;
	}

	if (columnType.includes("json")) {
		return <JsonFieldInput {...commonProps} />;
	}

	if (columnType === "text" || columnType.includes("varchar")) {
		return <TextFieldInput {...commonProps} />;
	}

	if (isNumericType(columnType)) {
		return <NumericFieldInput {...commonProps} />;
	}

	if (isTimestampType(columnType)) {
		return <TimestampFieldInput {...commonProps} />;
	}

	if (columnType === "uuid") {
		return <UuidFieldInput {...commonProps} />;
	}

	return <DefaultFieldInput {...commonProps} />;
}
