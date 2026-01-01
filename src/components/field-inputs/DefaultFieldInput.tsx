import { Input } from "@/components/ui/input";
import { FunctionCombobox } from "./FunctionCombobox";
import { SqlFunctionBadge } from "./SqlFunctionBadge";
import { NullButton } from "./NullButton";
import { UuidButton } from "./UuidButton";
import { isUuidColumn } from "@/lib/columnUtils";
import type { FieldInputProps } from "./types";

export function DefaultFieldInput({
	column,
	value,
	isRawSql,
	isNull,
	suggestedFunctions,
	onValueChange,
}: FieldInputProps) {
	const stringValue = isNull
		? ""
		: typeof value === "object"
			? JSON.stringify(value)
			: String(value ?? "");

	const placeholder = isNull
		? "NULL"
		: column.default
			? `Default: ${column.default}`
			: "";

	if (suggestedFunctions.length === 0) {
		return (
			<div className="space-y-1">
				<Input
					type="text"
					value={stringValue}
					onChange={(e) => onValueChange(e.target.value, false)}
					placeholder={placeholder}
					className="flex-1"
				/>
				<div className="flex items-center gap-2">
					{isUuidColumn(column) && (
						<UuidButton onGenerate={(uuid) => onValueChange(uuid, false)} />
					)}
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
				value={stringValue}
				suggestedFunctions={suggestedFunctions}
				placeholder={placeholder}
				onValueChange={(newValue, isFunction) =>
					onValueChange(newValue, isFunction)
				}
			/>
			<SqlFunctionBadge isRawSql={isRawSql} />
			<div className="flex items-center gap-2">
				{isUuidColumn(column) && (
					<UuidButton onGenerate={(uuid) => onValueChange(uuid, false)} />
				)}
				<NullButton
					isNull={isNull}
					nullable={column.nullable}
					onToggle={() => onValueChange(isNull ? "" : null, false)}
				/>
			</div>
		</div>
	);
}
