import { Textarea } from "@/components/ui/textarea";
import { FunctionCombobox } from "./FunctionCombobox";
import { SqlFunctionBadge } from "./SqlFunctionBadge";
import { NullButton } from "./NullButton";
import { UuidButton } from "./UuidButton";
import { isUuidColumn } from "@/lib/columnUtils";
import { ExpandableText } from "@/components/ExpandableText";
import type { FieldInputProps } from "./types";

export function TextFieldInput({
	column,
	value,
	isRawSql,
	isNull,
	suggestedFunctions,
	onValueChange,
	isReadonly = false,
}: FieldInputProps) {
	const stringValue = isNull ? "" : String(value ?? "");
	const placeholder = isNull
		? "NULL"
		: column.default
			? `Default: ${column.default}`
			: suggestedFunctions.length > 0
				? "Enter value or select function"
				: "";

	if (isReadonly) {
		return (
			<ExpandableText
				value={stringValue}
				isNull={isNull}
			/>
		);
	}

	if (suggestedFunctions.length > 0) {
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

	return (
		<div className="space-y-1">
			<Textarea
				value={stringValue}
				onChange={(e) => onValueChange(e.target.value, false)}
				placeholder={isNull ? "NULL" : ""}
				className="min-h-[60px]"
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
