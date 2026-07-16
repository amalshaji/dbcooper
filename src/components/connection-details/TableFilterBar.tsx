import { Code, Funnel, Plus } from "@phosphor-icons/react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import type { TableColumn } from "@/types/tabTypes";
import {
	describeFilterExpression,
	isConditionComplete,
	type FilterCondition,
	type FilterExpression,
} from "@/lib/resultFilters";
import { FilterConditionRow } from "./FilterConditionRow";

interface TableFilterBarProps {
	mode: "structured" | "advanced";
	filter: string;
	filterInput: string;
	structuredFilter: FilterExpression | null;
	structuredFilterInput: FilterExpression;
	columns: TableColumn[];
	loading: boolean;
	showInput: boolean;
	onModeChange: (mode: "structured" | "advanced") => void;
	onInputChange: (value: string) => void;
	onStructuredInputChange: (value: FilterExpression) => void;
	onApply: () => void;
	onClear: () => void;
}

function emptyCondition(columns: TableColumn[]): FilterCondition {
	return {
		column: columns[0]?.name ?? "",
		operator: "equals",
		value: "",
	};
}

export function TableFilterBar({
	mode,
	filter,
	filterInput,
	structuredFilter,
	structuredFilterInput,
	columns,
	loading,
	showInput,
	onModeChange,
	onInputChange,
	onStructuredInputChange,
	onApply,
	onClear,
}: TableFilterBarProps) {
	const hasActiveFilter = Boolean(
		filter || structuredFilter?.conditions.length,
	);
	if (!showInput && !hasActiveFilter) return null;

	const updateCondition = (
		index: number,
		updates: Partial<FilterCondition>,
	) => {
		onStructuredInputChange({
			...structuredFilterInput,
			conditions: structuredFilterInput.conditions.map(
				(condition, itemIndex) =>
					itemIndex === index ? { ...condition, ...updates } : condition,
			),
		});
	};

	const removeCondition = (index: number) => {
		onStructuredInputChange({
			...structuredFilterInput,
			conditions: structuredFilterInput.conditions.filter(
				(_, itemIndex) => itemIndex !== index,
			),
		});
	};

	const canApply =
		mode === "advanced"
			? Boolean(filterInput.trim())
			: structuredFilterInput.conditions.length > 0 &&
				structuredFilterInput.conditions.every(isConditionComplete);

	return (
		<div className="mx-6 mb-3 overflow-hidden rounded-xl border bg-muted/20 shadow-sm">
			{showInput && (
				<div className="space-y-4 p-4">
					<div className="flex items-center justify-between">
						<div
							className="flex rounded-lg bg-muted p-0.5"
							role="tablist"
							aria-label="Filter mode"
						>
							<Button
								variant={mode === "structured" ? "secondary" : "ghost"}
								size="sm"
								onClick={() => onModeChange("structured")}
							>
								<Funnel /> Builder
							</Button>
							<Button
								variant={mode === "advanced" ? "secondary" : "ghost"}
								size="sm"
								onClick={() => onModeChange("advanced")}
							>
								<Code /> Advanced
							</Button>
						</div>
						<span className="text-[11px] text-muted-foreground">
							{mode === "structured"
								? "Values are safely parameterized"
								: "SQL WHERE clause"}
						</span>
					</div>

					{mode === "structured" ? (
						<div className="space-y-3">
							{structuredFilterInput.conditions.map((condition, index) => (
								<FilterConditionRow
									key={`${index}-${condition.column}`}
									condition={condition}
									columns={columns}
									conjunction={structuredFilterInput.conjunction}
									showConjunction={index > 0}
									canApply={canApply}
									onConjunctionChange={(conjunction) =>
										onStructuredInputChange({
											...structuredFilterInput,
											conjunction,
										})
									}
									onChange={(updates) => updateCondition(index, updates)}
									onRemove={() => removeCondition(index)}
									onApply={onApply}
								/>
							))}
						</div>
					) : (
						<Input
							placeholder="status = 'active' AND created_at > now() - interval '7 days'"
							value={filterInput}
							onChange={(event) => onInputChange(event.target.value)}
							onKeyDown={(event) => {
								if (event.key === "Enter" && canApply) onApply();
							}}
							className="font-mono text-xs"
						/>
					)}

					<div className="flex items-center justify-between">
						{mode === "structured" && (
							<Button
								variant="ghost"
								size="sm"
								onClick={() =>
									onStructuredInputChange({
										...structuredFilterInput,
										conditions: [
											...structuredFilterInput.conditions,
											emptyCondition(columns),
										],
									})
								}
								disabled={!columns.length}
							>
								<Plus /> Add condition
							</Button>
						)}
						<Button
							size="sm"
							className="ml-auto"
							onClick={onApply}
							disabled={loading || !canApply}
						>
							Apply filter
						</Button>
					</div>
				</div>
			)}

			{hasActiveFilter && (
				<div className="flex items-center justify-between border-t bg-background/60 px-3 py-2 text-xs">
					<span className="truncate text-muted-foreground">
						Active:{" "}
						<span className="font-medium text-foreground">
							{structuredFilter
								? describeFilterExpression(structuredFilter)
								: filter}
						</span>
					</span>
					<Button
						size="sm"
						variant="ghost"
						onClick={onClear}
						disabled={loading}
					>
						Clear
					</Button>
				</div>
			)}
		</div>
	);
}
