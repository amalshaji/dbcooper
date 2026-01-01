import { Switch } from "@/components/ui/switch";
import { NullButton } from "./NullButton";
import type { FieldInputProps } from "./types";

export function BooleanFieldInput({
	column,
	value,
	isNull,
	dbType,
	onValueChange,
	isReadonly = false,
}: FieldInputProps) {
	const isTrue = value === true || value === "TRUE" || value === "1";
	const isFalse = value === false || value === "FALSE" || value === "0";

	return (
		<div className="flex items-center gap-2">
			<Switch
				checked={isTrue}
				onCheckedChange={(checked) =>
					onValueChange(
						dbType === "sqlite" ? (checked ? "1" : "0") : checked,
						false,
					)
				}
				disabled={isReadonly}
			/>
			<span className="text-sm text-muted-foreground">
				{isTrue ? "true" : isFalse ? "false" : "null"}
			</span>
			{!isReadonly && (
				<NullButton
					isNull={isNull}
					nullable={column.nullable}
					onToggle={() => onValueChange(isNull ? false : null, false)}
				/>
			)}
		</div>
	);
}
