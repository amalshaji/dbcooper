import { X } from "@phosphor-icons/react";
import { Button } from "@/components/ui/button";
import {
	Select,
	SelectContent,
	SelectItem,
	SelectTrigger,
	SelectValue,
} from "@/components/ui/select";
import {
	changeFilterConditionColumn,
	changeFilterConditionOperator,
	FILTER_OPERATOR_LABELS,
	type FilterCondition,
	type FilterExpression,
	type FilterOperator,
	getFilterOperatorsForColumn,
} from "@/lib/resultFilters";
import type { TableColumn } from "@/types/tabTypes";
import { FilterValueInput } from "./FilterValueInput";

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
	const selectedColumn = columns.find(
		(column) => column.name === condition.column,
	);
	const filterOperators = selectedColumn
		? getFilterOperatorsForColumn(selectedColumn.filter_kind)
		: [];

	return (
		<div className="flex items-center gap-2">
			{showConjunction && (
				<Select
					value={conjunction}
					onValueChange={(value) => {
						if (value) onConjunctionChange(value);
					}}
				>
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
				onValueChange={(columnName) => {
					if (!columnName) return;
					const column = columns.find((item) => item.name === columnName);
					onChange(
						changeFilterConditionColumn(
							condition,
							columnName,
							column?.filter_kind ?? "other",
						),
					);
				}}
			>
				<SelectTrigger size="sm" className="w-40" aria-label="Filter column">
					<SelectValue />
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
				disabled={!selectedColumn}
				onValueChange={(operator) =>
					onChange(
						changeFilterConditionOperator(
							condition,
							operator as FilterOperator,
						),
					)
				}
			>
				<SelectTrigger size="sm" className="w-40" aria-label="Filter operator">
					<SelectValue />
				</SelectTrigger>
				<SelectContent>
					{filterOperators.map((operator) => (
						<SelectItem key={operator} value={operator}>
							{FILTER_OPERATOR_LABELS[operator]}
						</SelectItem>
					))}
				</SelectContent>
			</Select>
			{selectedColumn && (
				<FilterValueInput
					condition={condition}
					column={selectedColumn}
					canApply={canApply}
					onChange={(value) => onChange({ value })}
					onApply={onApply}
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
