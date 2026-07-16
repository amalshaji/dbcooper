import { X } from "@phosphor-icons/react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
	Select,
	SelectContent,
	SelectItem,
	SelectTrigger,
	SelectValue,
} from "@/components/ui/select";
import {
	FILTER_OPERATORS,
	FILTER_OPERATOR_LABELS,
	operatorNeedsValue,
	type FilterCondition,
	type FilterExpression,
	type FilterOperator,
} from "@/lib/resultFilters";
import type { TableColumn } from "@/types/tabTypes";

interface FilterConditionRowProps {
	condition: FilterCondition;
	columns: TableColumn[];
	conjunction: FilterExpression["conjunction"];
	showConjunction: boolean;
	canApply: boolean;
	onConjunctionChange: (value: FilterExpression["conjunction"]) => void;
	onChange: (updates: Partial<FilterCondition>) => void;
	onRemove: () => void;
	onApply: () => void;
}

export function FilterConditionRow({
	condition,
	columns,
	conjunction,
	showConjunction,
	canApply,
	onConjunctionChange,
	onChange,
	onRemove,
	onApply,
}: FilterConditionRowProps) {
	return (
		<div className="flex items-center gap-2">
			{showConjunction && (
				<Select value={conjunction} onValueChange={onConjunctionChange}>
					<SelectTrigger size="sm" className="w-16">
						<SelectValue />
					</SelectTrigger>
					<SelectContent>
						<SelectItem value="and">and</SelectItem>
						<SelectItem value="or">or</SelectItem>
					</SelectContent>
				</Select>
			)}
			<Select
				value={condition.column}
				onValueChange={(column) => onChange({ column })}
			>
				<SelectTrigger size="sm" className="w-40">
					<SelectValue placeholder="Column" />
				</SelectTrigger>
				<SelectContent>
					{columns.map((column) => (
						<SelectItem key={column.name} value={column.name}>
							{column.name}
						</SelectItem>
					))}
				</SelectContent>
			</Select>
			<Select
				value={condition.operator}
				onValueChange={(operator) =>
					onChange({
						operator: operator as FilterOperator,
						value: operatorNeedsValue(operator as FilterOperator)
							? (condition.value ?? "")
							: undefined,
					})
				}
			>
			<SelectTrigger size="sm" className="w-40">
					<SelectValue />
				</SelectTrigger>
				<SelectContent>
					{FILTER_OPERATORS.map((operator) => (
						<SelectItem key={operator} value={operator}>
							{FILTER_OPERATOR_LABELS[operator]}
						</SelectItem>
					))}
				</SelectContent>
			</Select>
			{operatorNeedsValue(condition.operator) && (
				<Input
					value={
						Array.isArray(condition.value)
							? condition.value.join(", ")
							: String(condition.value ?? "")
					}
					onChange={(event) => onChange({ value: event.target.value })}
					onKeyDown={(event) => {
						if (event.key === "Enter" && canApply) onApply();
					}}
					placeholder={condition.operator === "in" ? "value, value" : "Value"}
					className="h-7 flex-1 font-mono text-xs"
				/>
			)}
			<Button
				variant="ghost"
				size="icon-sm"
				onClick={onRemove}
				aria-label="Remove filter"
			>
				<X />
			</Button>
		</div>
	);
}
