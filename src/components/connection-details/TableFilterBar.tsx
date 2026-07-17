import { Code, Funnel, Plus } from "@phosphor-icons/react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import type { TableColumn } from "@/types/tabTypes";
import {
	describeFilterExpression,
	isConditionComplete,
	type FilterCondition,
	type FilterExpression,
	type TableFilterState,
} from "@/lib/resultFilters";
import { FilterConditionRow } from "./FilterConditionRow";

interface TableFilterBarProps {
	state: TableFilterState;
	columns: TableColumn[];
	loading: boolean;
	showInput: boolean;
	onStateChange: (state: TableFilterState) => void;
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
	state,
	columns,
	loading,
	showInput,
	onStateChange,
	onApply,
	onClear,
}: TableFilterBarProps) {
	const mode = state.draft.kind;
	const structuredFilterInput =
		state.draft.kind === "structured"
			? state.draft.value
			: { conjunction: "and" as const, conditions: [] };
	const filterInput = state.draft.kind === "advanced" ? state.draft.value : "";
	const hasActiveFilter = state.applied !== null;
	if (!showInput && !hasActiveFilter) return null;

	const setStructuredDraft = (value: FilterExpression) =>
		onStateChange({ ...state, draft: { kind: "structured", value } });

	const updateCondition = (
		index: number,
		updates: Partial<FilterCondition>,
	) => {
		setStructuredDraft({
			...structuredFilterInput,
			conditions: structuredFilterInput.conditions.map(
				(condition, itemIndex) =>
					itemIndex === index ? { ...condition, ...updates } : condition,
			),
		});
	};

	const removeCondition = (index: number) => {
		setStructuredDraft({
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
								onClick={() =>
									onStateChange({
										...state,
										draft: {
											kind: "structured",
											value: { conjunction: "and", conditions: [] },
										},
									})
								}
							>
								<Funnel /> Builder
							</Button>
							<Button
								variant={mode === "advanced" ? "secondary" : "ghost"}
								size="sm"
								onClick={() =>
									onStateChange({
										...state,
										draft: { kind: "advanced", value: "" },
									})
								}
							>
								<Code /> Advanced
							</Button>
						</div>
						{mode === "advanced" && (
							<span className="text-[11px] text-muted-foreground">
								SQL WHERE clause
							</span>
						)}
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
										setStructuredDraft({
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
							onChange={(event) =>
								onStateChange({
									...state,
									draft: { kind: "advanced", value: event.target.value },
								})
							}
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
									setStructuredDraft({
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
							{state.applied?.kind === "structured"
								? describeFilterExpression(state.applied.value)
								: state.applied?.value}
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
