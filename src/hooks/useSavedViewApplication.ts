import { useCallback } from "react";
import { toast } from "sonner";
import { createTableFilterState } from "../lib/resultFilters";
import { reconcileSavedViewState } from "../lib/savedViews";
import type { SavedView, TableDataResponse } from "../lib/tauri";
import type { UpdateTab } from "../lib/connection-details/tabState";
import type { TableDataTab } from "../types/tabTypes";

interface PreparedSavedViewApplication {
	nextTab: TableDataTab | null;
	warning: string | null;
	error: string | null;
}

export function prepareSavedViewApplication(
	tab: TableDataTab,
	view: SavedView,
): PreparedSavedViewApplication {
	const reconciled = reconcileSavedViewState(
		view.state,
		tab.columns.map((column) => column.name),
	);
	if (!reconciled.state) {
		return { nextTab: null, warning: null, error: reconciled.error };
	}

	const filterState = reconciled.state.filter
		? {
				draft: reconciled.state.filter,
				applied: reconciled.state.filter,
			}
		: createTableFilterState();

	return {
		nextTab: {
			...tab,
			currentPage: 1,
			filterState,
			sort: reconciled.state.sort,
			columnLayout: reconciled.layout,
		},
		warning: reconciled.warning,
		error: null,
	};
}

interface UseSavedViewApplicationOptions {
	tab: TableDataTab | null;
	requestTableData: (tab: TableDataTab) => Promise<TableDataResponse>;
	updateTab: UpdateTab<TableDataTab>;
}

export function useSavedViewApplication({
	tab,
	requestTableData,
	updateTab,
}: UseSavedViewApplicationOptions) {
	return useCallback(
		async (view: SavedView) => {
			if (!tab) return false;
			const prepared = prepareSavedViewApplication(tab, view);
			if (!prepared.nextTab) {
				toast.error("Couldn’t apply saved view", {
					description: prepared.error,
				});
				return false;
			}

			const nextTab = prepared.nextTab;
			updateTab(tab.id, { loading: true });
			try {
				const data = await requestTableData(nextTab);
				updateTab(tab.id, {
					data,
					currentPage: nextTab.currentPage,
					filterState: nextTab.filterState,
					sort: nextTab.sort,
					columnLayout: nextTab.columnLayout,
					loading: false,
				});
				if (prepared.warning) {
					toast.warning("Saved view adjusted", {
						description: prepared.warning,
					});
				}
				return true;
			} catch (error) {
				toast.error("Couldn’t apply saved view", {
					description: error instanceof Error ? error.message : String(error),
				});
				updateTab(tab.id, { loading: false });
				return false;
			}
		},
		[requestTableData, tab, updateTab],
	);
}
