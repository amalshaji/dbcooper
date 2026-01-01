import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { FunctionCombobox } from "./FunctionCombobox";
import { SqlFunctionBadge } from "./SqlFunctionBadge";
import { isSqlFunction } from "@/lib/sqlFunctions";
import type { FieldInputProps } from "./types";

function isIntegerType(columnType: string): boolean {
	return columnType.includes("int") || columnType.includes("serial");
}

function parseNumericValue(value: string, columnType: string): number {
	return isIntegerType(columnType)
		? parseInt(value, 10)
		: parseFloat(value);
}

export function NumericFieldInput({
	column,
	value,
	isRawSql,
	isNull,
	suggestedFunctions,
	onValueChange,
	isReadonly = false,
}: FieldInputProps) {
	const columnType = column.type.toLowerCase();
	const displayValue = isNull
		? ""
		: isRawSql
			? String(value)
			: String(value ?? "");

	const placeholder = isNull
		? "NULL"
		: column.default
			? `Default: ${column.default}`
			: "";

	if (isReadonly) {
		return (
			<Input
				type="text"
				value={displayValue}
				disabled
				className="flex-1"
			/>
		);
	}

	if (suggestedFunctions.length === 0) {
		return (
			<div className="flex items-center gap-2">
				<Input
					type="number"
					value={displayValue}
					onChange={(e) => {
						const val = e.target.value;
						if (val === "") {
							onValueChange(null, false);
						} else {
							const numValue = parseNumericValue(val, columnType);
							onValueChange(numValue, false);
						}
					}}
					placeholder={placeholder}
					className="flex-1"
				/>
				{column.nullable && (
					<Button
						variant="ghost"
						size="sm"
						className="h-8 text-xs"
						onClick={() => onValueChange(isNull ? 0 : null, false)}
					>
						{isNull ? "Set 0" : "NULL"}
					</Button>
				)}
			</div>
		);
	}

	return (
		<div className="space-y-1">
			<FunctionCombobox
				value={displayValue}
				suggestedFunctions={suggestedFunctions}
				placeholder={placeholder}
				onValueChange={(newValue, isFunction) => {
					if (isFunction || isSqlFunction(newValue)) {
						onValueChange(newValue, true);
					} else if (newValue === "") {
						onValueChange(null, false);
					} else {
						const numValue = parseNumericValue(newValue, columnType);
						onValueChange(
							Number.isNaN(numValue) ? newValue : numValue,
							false,
						);
					}
				}}
			/>
			<SqlFunctionBadge isRawSql={isRawSql} />
			{column.nullable && (
				<Button
					variant="ghost"
					size="sm"
					className="h-6 text-xs"
					onClick={() => onValueChange(isNull ? 0 : null, false)}
				>
					{isNull ? "Set 0" : "NULL"}
				</Button>
			)}
		</div>
	);
}
