import { useCallback } from "react";
import {
	coerceFilterExpression,
	createCellFilter,
	createTableFilterState,
	type FilterExpression,
	type TableFilterState,
} from "@/lib/resultFilters";
import type { TableDataTab } from "@/types/tabTypes";

interface UseTableDataFiltersOptions {
	tab: TableDataTab | null;
	updateTab: (id: string, updates: Partial<TableDataTab>) => void;
	fetchTableData: (tab: TableDataTab) => void;
}

export function useTableDataFilters({
	tab,
	updateTab,
	fetchTableData,
}: UseTableDataFiltersOptions) {
	const setFilterState = useCallback(
		(filterState: TableFilterState) => {
			if (tab) updateTab(tab.id, { filterState });
		},
		[tab, updateTab],
	);

	const applyFilter = useCallback(() => {
		if (!tab) return;
		const draft = tab.filterState.draft;
		const applied =
			draft.kind === "advanced"
				? draft
				: {
						kind: "structured" as const,
						value: coerceFilterExpression(
							draft.value,
							Object.fromEntries(
								tab.columns.map((column) => [column.name, column.filter_kind]),
							),
						),
					};
		const nextTab = {
			...tab,
			filterState: { ...tab.filterState, applied },
			currentPage: 1,
		};
		updateTab(tab.id, nextTab);
		fetchTableData(nextTab);
	}, [tab, updateTab, fetchTableData]);

	const clearFilter = useCallback(() => {
		if (!tab) return;
		const filterState = createTableFilterState();
		const nextTab = { ...tab, filterState, currentPage: 1 };
		updateTab(tab.id, nextTab);
		fetchTableData(nextTab);
	}, [tab, updateTab, fetchTableData]);

	const filterCell = useCallback(
		(column: string, value: unknown, exclude: boolean) => {
			if (!tab) return;
			const applied = tab.filterState.applied;
			const currentExpression =
				applied?.kind === "structured"
					? applied.value
					: { conjunction: "and" as const, conditions: [] };
			const expression: FilterExpression = {
				conjunction: currentExpression.conjunction,
				conditions: [
					...currentExpression.conditions,
					createCellFilter(column, value, exclude),
				],
			};
			const filter = { kind: "structured" as const, value: expression };
			const nextTab = {
				...tab,
				filterState: { draft: filter, applied: filter },
				currentPage: 1,
			};
			updateTab(tab.id, nextTab);
			fetchTableData(nextTab);
		},
		[tab, updateTab, fetchTableData],
	);

	return { setFilterState, applyFilter, clearFilter, filterCell };
}
