import { Textarea } from "@/components/ui/textarea";
import { NullButton } from "./NullButton";
import type { FieldInputProps } from "./types";

export function JsonFieldInput({
	column,
	value,
	isNull,
	onValueChange,
	isReadonly = false,
}: FieldInputProps) {
	const stringValue =
		typeof value === "object" && value !== null
			? JSON.stringify(value, null, 2)
			: value === null
				? ""
				: String(value);

	return (
		<div className="space-y-1">
			<Textarea
				value={isNull ? "" : stringValue}
				onChange={(e) => {
					try {
						const parsed = JSON.parse(e.target.value);
						onValueChange(parsed, false);
					} catch {
						onValueChange(e.target.value, false);
					}
				}}
				placeholder={isNull ? "NULL" : ""}
				className="font-mono text-xs min-h-[80px]"
				disabled={isReadonly}
			/>
			{!isReadonly && (
				<NullButton
					isNull={isNull}
					nullable={column.nullable}
					onToggle={() => onValueChange(isNull ? {} : null, false)}
				/>
			)}
		</div>
	);
}
