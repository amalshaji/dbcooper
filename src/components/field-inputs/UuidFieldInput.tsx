import { Input } from "@/components/ui/input";
import { FunctionCombobox } from "./FunctionCombobox";
import { SqlFunctionBadge } from "./SqlFunctionBadge";
import { NullButton } from "./NullButton";
import { UuidButton } from "./UuidButton";
import type { FieldInputProps } from "./types";

export function UuidFieldInput({
	column,
	value,
	isRawSql,
	isNull,
	suggestedFunctions,
	onValueChange,
}: FieldInputProps) {
	const displayValue = isNull ? "" : String(value ?? "");
	const placeholder = isNull
		? "NULL"
		: column.default
			? `Default: ${column.default}`
			: suggestedFunctions.length > 0
				? "Enter UUID or select function"
				: "Enter UUID";

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
				<div className="flex items-center gap-2">
					<UuidButton onGenerate={(uuid) => onValueChange(uuid, false)} />
					<NullButton
						isNull={isNull}
						nullable={column.nullable}
						onToggle={() => onValueChange(isNull ? "" : null, false)}
					/>
				</div>
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
			<div className="flex items-center gap-2">
				<UuidButton onGenerate={(uuid) => onValueChange(uuid, false)} />
				<NullButton
					isNull={isNull}
					nullable={column.nullable}
					onToggle={() => onValueChange(isNull ? "" : null, false)}
				/>
			</div>
		</div>
	);
}
