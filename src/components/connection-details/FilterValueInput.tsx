import { Input } from "@/components/ui/input";
import {
	Select,
	SelectContent,
	SelectItem,
	SelectTrigger,
	SelectValue,
} from "@/components/ui/select";
import {
	type FilterCondition,
	getFilterColumnKind,
	operatorNeedsValue,
} from "@/lib/resultFilters";
import type { TableColumn } from "@/types/tabTypes";

interface FilterValueInputProps {
	condition: FilterCondition;
	column: TableColumn;
	canApply: boolean;
	onChange: (value: FilterCondition["value"]) => void;
	onApply: () => void;
}

function stringifyFilterValue(value: FilterCondition["value"]): string {
	if (Array.isArray(value)) {
		return value
			.map((item) =>
				typeof item === "object" && item !== null ? item.value : String(item),
			)
			.join(", ");
	}
	if (typeof value === "object" && value !== null) return value.value;
	return String(value ?? "");
}

function getTemporalPlaceholder(dataType: string): string {
	const normalizedType = dataType.toLowerCase();
	if (
		normalizedType.includes("timestamp") ||
		normalizedType.includes("datetime")
	) {
		return "YYYY-MM-DD HH:MM:SS";
	}
	if (normalizedType.includes("time")) return "HH:MM:SS";
	return "YYYY-MM-DD";
}

function getValuePlaceholder(column: TableColumn): string {
	switch (getFilterColumnKind(column.type)) {
		case "integer":
			return "0";
		case "decimal":
			return "0.0";
		case "temporal":
			return getTemporalPlaceholder(column.type);
		case "uuid":
			return "UUID";
		default:
			return "Value";
	}
}

function getListPlaceholder(column: TableColumn): string {
	switch (getFilterColumnKind(column.type)) {
		case "integer":
			return "1, 2";
		case "decimal":
			return "1.5, 2.5";
		case "temporal":
			return `${getTemporalPlaceholder(column.type)}, …`;
		case "uuid":
			return "uuid, uuid";
		default:
			return "value, value";
	}
}

export function FilterValueInput({
	condition,
	column,
	canApply,
	onChange,
	onApply,
}: FilterValueInputProps) {
	if (!operatorNeedsValue(condition.operator)) return null;

	const columnKind = getFilterColumnKind(column.type);
	const inputValue = stringifyFilterValue(condition.value);
	const ariaLabel = `Filter value for ${column.name}`;

	if (columnKind === "boolean") {
		const booleanValue =
			inputValue === "true" || inputValue === "false" ? inputValue : null;

		return (
			<Select value={booleanValue} onValueChange={onChange}>
				<SelectTrigger size="sm" className="flex-1" aria-label={ariaLabel}>
					<SelectValue placeholder="Value" />
				</SelectTrigger>
				<SelectContent>
					<SelectItem value="true">true</SelectItem>
					<SelectItem value="false">false</SelectItem>
				</SelectContent>
			</Select>
		);
	}

	const isList = condition.operator === "in";
	const isNumeric = columnKind === "integer" || columnKind === "decimal";

	return (
		<Input
			type={!isList && isNumeric ? "number" : "text"}
			step={
				!isList && columnKind === "integer"
					? "1"
					: !isList && columnKind === "decimal"
						? "any"
						: undefined
			}
			value={inputValue}
			onChange={(event) => onChange(event.target.value)}
			onKeyDown={(event) => {
				if (event.key === "Enter" && canApply) onApply();
			}}
			placeholder={
				isList ? getListPlaceholder(column) : getValuePlaceholder(column)
			}
			aria-label={ariaLabel}
			className="h-7 flex-1 font-mono text-xs"
		/>
	);
}
