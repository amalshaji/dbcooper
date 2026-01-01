import { Input } from "@/components/ui/input";
import { FunctionCombobox } from "./FunctionCombobox";
import { SqlFunctionBadge } from "./SqlFunctionBadge";
import { NullButton } from "./NullButton";
import type { FieldInputProps } from "./types";

export function TimestampFieldInput({
	column,
	value,
	isRawSql,
	isNull,
	suggestedFunctions,
	onValueChange,
	isReadonly = false,
}: FieldInputProps) {
	const displayValue = isNull ? "" : String(value ?? "");
	const placeholder = isNull
		? "NULL"
		: column.default
			? `Default: ${column.default}`
			: suggestedFunctions.length > 0
				? "Enter date/time or select function"
				: "Enter date/time";

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
			<div className="space-y-1">
				<Input
					type="text"
					value={displayValue}
					onChange={(e) => onValueChange(e.target.value, false)}
					placeholder={placeholder}
					className="flex-1"
				/>
				<NullButton
					isNull={isNull}
					nullable={column.nullable}
					onToggle={() => onValueChange(isNull ? "" : null, false)}
				/>
			</div>
		);
	}

	return (
		<div className="space-y-1">
			<FunctionCombobox
				value={displayValue}
				suggestedFunctions={suggestedFunctions}
				placeholder={placeholder}
				onValueChange={(newValue, isFunction) =>
					onValueChange(newValue, isFunction)
				}
			/>
			<SqlFunctionBadge isRawSql={isRawSql} />
			<NullButton
				isNull={isNull}
				nullable={column.nullable}
				onToggle={() => onValueChange(isNull ? "" : null, false)}
			/>
		</div>
	);
}
