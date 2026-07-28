import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";
import { useSavedViewApplication } from "../useSavedViewApplication";
import { useTableDataFilters } from "../useTableDataFilters";
import { continueWhileCurrent } from "../../lib/connection-details/latestRequestRegistry";
import {
	areCellValuesEqual,
	getPrimaryKeyRowKey,
} from "../../lib/connection-details/queryTableState";
import type { UpdateTab } from "../../lib/connection-details/tabState";
import type { TabRequestController } from "../../lib/connection-details/tabRequestController";
import { getFilterRequest } from "../../lib/resultFilters";
import type { TableColumnLayout } from "../../lib/savedViews";
import { api } from "../../lib/tauri";
import type { SqlConnection } from "../../types/connection";
import type { SortConfig, TableDataTab } from "../../types/tabTypes";

export interface PendingInlineCellEdit {
	row: Record<string, unknown>;
	columnName: string;
	value: unknown;
}

export interface HighlightedTableRow {
	tableName: string;
	rowKey: string;
}

export interface RowMutationValue {
	column: string;
	value: unknown;
	isRawSql: boolean;
}

export interface UseTableDataControllerOptions {
	connection: SqlConnection;
	activeTab: TableDataTab | null;
	updateTableDataTab: UpdateTab<TableDataTab>;
	requestController: TabRequestController;
}

export function useTableDataController({
	connection,
	activeTab,
	updateTableDataTab,
	requestController,
}: UseTableDataControllerOptions) {
	const [rowEditSheetOpen, setRowEditSheetOpen] = useState(false);
	const [editingRow, setEditingRow] = useState<Record<string, unknown> | null>(
		null,
	);
	const [savingRow, setSavingRow] = useState(false);
	const [deletingRow, setDeletingRow] = useState(false);
	const [highlightedTableRow, setHighlightedTableRow] =
		useState<HighlightedTableRow | null>(null);
	const [pendingInlineEditsByTab, setPendingInlineEditsByTab] = useState<
		Record<string, Record<string, PendingInlineCellEdit>>
	>({});
	const [savingInlineEdits, setSavingInlineEdits] = useState(false);
	const [rowInsertSheetOpen, setRowInsertSheetOpen] = useState(false);
	const [insertingRow, setInsertingRow] = useState(false);

	useEffect(() => {
		setSavingRow(false);
		setSavingInlineEdits(false);
		setDeletingRow(false);
		setInsertingRow(false);
	}, [connection.uuid]);

	const requestTableData = useCallback(
		async (tab: TableDataTab) => {
			const [schema, tableName] = tab.tableName.split(".");
			const filterRequest = getFilterRequest(tab.filterState.applied);
			return api.pool.getTableData(
				connection.uuid,
				schema,
				tableName,
				tab.currentPage,
				100,
				filterRequest.filter,
				filterRequest.structuredFilter,
				tab.sort?.column,
				tab.sort?.direction,
			);
		},
		[connection.uuid],
	);

	const fetchTableData = useCallback(
		async (tab: TableDataTab) => {
			const request = requestController.beginTable(tab.id);
			updateTableDataTab(tab.id, { loading: true });
			try {
				const data = await requestTableData(tab);
				request.commit(() =>
					updateTableDataTab(tab.id, { data, loading: false }),
				);
			} catch (error) {
				if (!request.isCurrent()) return;
				console.error("Failed to fetch table data:", error);
				toast.error("Failed to load table data", {
					description: error instanceof Error ? error.message : String(error),
				});
				updateTableDataTab(tab.id, { data: null, loading: false });
			}
		},
		[requestController, requestTableData, updateTableDataTab],
	);

	const {
		setFilterState: handleTableFilterStateChange,
		applyFilter: handleApplyFilter,
		clearFilter: clearTableFilter,
		filterCell: handleCellFilter,
	} = useTableDataFilters({
		tab: activeTab,
		updateTab: updateTableDataTab,
		fetchTableData,
	});

	const handleApplySavedView = useSavedViewApplication({
		tab: activeTab,
		requestTableData,
		requestController,
		updateTab: updateTableDataTab,
	});

	const handleRefreshTableData = useCallback(async () => {
		if (!activeTab) return;
		const tab = activeTab;
		updateTableDataTab(tab.id, { currentPage: 1 });
		fetchTableData({ ...tab, currentPage: 1 });
	}, [activeTab, updateTableDataTab, fetchTableData]);

	const handlePageChange = useCallback(
		(page: number) => {
			if (!activeTab) return;
			const tab = activeTab;
			updateTableDataTab(tab.id, { currentPage: page });
			fetchTableData({ ...tab, currentPage: page });
		},
		[activeTab, updateTableDataTab, fetchTableData],
	);

	const handleSortChange = useCallback(
		(sort: SortConfig | null) => {
			if (!activeTab) return;
			const tab = activeTab;
			updateTableDataTab(tab.id, { sort, currentPage: 1 });
			fetchTableData({ ...tab, sort, currentPage: 1 });
		},
		[activeTab, updateTableDataTab, fetchTableData],
	);

	const handleRowClick = useCallback((row: Record<string, unknown>) => {
		setEditingRow(row);
		setRowEditSheetOpen(true);
	}, []);
	const handleRowEditOpenChange = useCallback((open: boolean) => {
		setRowEditSheetOpen(open);
		if (!open) setEditingRow(null);
	}, []);
	const handleRowInsertOpenChange = useCallback((open: boolean) => {
		setRowInsertSheetOpen(open);
	}, []);
	const handleOpenRowInsert = useCallback(() => {
		setRowInsertSheetOpen(true);
	}, []);
	const handleActiveViewChange = useCallback(
		(savedViewId: number | null) => {
			if (activeTab) {
				updateTableDataTab(activeTab.id, { savedViewId });
			}
		},
		[activeTab, updateTableDataTab],
	);
	const handleColumnLayoutChange = useCallback(
		(columnLayout: TableColumnLayout) => {
			if (activeTab) {
				updateTableDataTab(activeTab.id, { columnLayout });
			}
		},
		[activeTab, updateTableDataTab],
	);

	const handleSaveRow = useCallback(
		async (updates: RowMutationValue[]) => {
			if (!activeTab || !editingRow) return;

			const tab = activeTab;
			const tableRequest = requestController.watchTable(tab.id);
			const [schema, tableName] = tab.tableName.split(".");
			const primaryKeyColumns = tab.columns
				.filter((column) => column.primary_key)
				.map((column) => column.name);
			const primaryKeyValues = primaryKeyColumns.map(
				(column) => editingRow[column],
			);

			if (primaryKeyColumns.length === 0) {
				toast.error("Cannot update row without primary key");
				return;
			}

			setSavingRow(true);

			try {
				const result = await api.pool.updateTableRow(
					connection.uuid,
					schema,
					tableName,
					primaryKeyColumns,
					primaryKeyValues,
					updates,
				);

				if (!tableRequest.isCurrent()) return;
				if (result.error) {
					toast.error("Failed to update row", { description: result.error });
				} else {
					const rowKey = getPrimaryKeyRowKey(editingRow, tab.columns);
					if (rowKey) {
						setHighlightedTableRow({ tableName: tab.tableName, rowKey });
					}
					toast.success("Row updated successfully");
					setRowEditSheetOpen(false);
					setEditingRow(null);
					setSavingRow(false);
					void fetchTableData(tab);
				}
			} catch (error) {
				if (!tableRequest.isCurrent()) return;
				console.error("Failed to update row:", error);
				toast.error("Failed to update row", {
					description: error instanceof Error ? error.message : String(error),
				});
			} finally {
				if (tableRequest.isCurrent()) setSavingRow(false);
			}
		},
		[
			connection,
			activeTab,
			editingRow,
			fetchTableData,
			requestController,
		],
	);

	const handleInlineCellSave = useCallback(
		async (
			row: Record<string, unknown>,
			columnName: string,
			value: unknown,
		) => {
			if (!activeTab) return;

			const tab = activeTab;
			const column = tab.columns.find((item) => item.name === columnName);
			if (!column || column.primary_key) {
				throw new Error("This column cannot be edited inline");
			}

			const rowKey = getPrimaryKeyRowKey(row, tab.columns);
			if (!rowKey) {
				throw new Error("Cannot update row without primary key");
			}

			const editKey = `${rowKey}:${columnName}`;

			setPendingInlineEditsByTab((previous) => {
				const tabEdits = { ...(previous[tab.id] ?? {}) };
				if (areCellValuesEqual(row[columnName], value)) {
					delete tabEdits[editKey];
				} else {
					tabEdits[editKey] = { row, columnName, value };
				}

				if (Object.keys(tabEdits).length === 0) {
					const next = { ...previous };
					delete next[tab.id];
					return next;
				}

				return { ...previous, [tab.id]: tabEdits };
			});
			toast.success("Change staged");
		},
		[activeTab],
	);

	const handleSaveInlineChanges = useCallback(async () => {
		if (!activeTab) return;

		const tab = activeTab;
		const tableRequest = requestController.watchTable(tab.id);
		const pendingEdits = Object.entries(pendingInlineEditsByTab[tab.id] ?? {});
		if (pendingEdits.length === 0) return;

		const primaryKeyColumns = tab.columns
			.filter((column) => column.primary_key)
			.map((column) => column.name);

		if (primaryKeyColumns.length === 0) {
			toast.error("Cannot update rows without primary key");
			return;
		}

		const [schema, tableName] = tab.tableName.split(".");
		const editsByRow = new Map<
			string,
			{
				row: Record<string, unknown>;
				updates: RowMutationValue[];
			}
		>();

		for (const [, edit] of pendingEdits) {
			const rowKey = getPrimaryKeyRowKey(edit.row, tab.columns);
			if (!rowKey) continue;

			const groupedEdit = editsByRow.get(rowKey) ?? {
				row: edit.row,
				updates: [],
			};
			groupedEdit.updates.push({
				column: edit.columnName,
				value: edit.value,
				isRawSql: false,
			});
			editsByRow.set(rowKey, groupedEdit);
		}

		if (editsByRow.size === 0) return;

		setSavingInlineEdits(true);
		try {
			const completed = await continueWhileCurrent(
				editsByRow,
				() => tableRequest.isCurrent(),
				async ([, editGroup]) => {
					const primaryKeyValues = primaryKeyColumns.map(
						(column) => editGroup.row[column],
					);
					return api.pool.updateTableRow(
						connection.uuid,
						schema,
						tableName,
						primaryKeyColumns,
						primaryKeyValues,
						editGroup.updates,
					);
				},
				(result, [rowKey]) => {
					if (result.error) throw new Error(result.error);
					setHighlightedTableRow({ tableName: tab.tableName, rowKey });
				},
			);
			if (!completed) return;

			setPendingInlineEditsByTab((previous) => {
				const next = { ...previous };
				delete next[tab.id];
				return next;
			});
			toast.success(
				`Committed ${pendingEdits.length} inline change${pendingEdits.length === 1 ? "" : "s"}`,
			);
			setSavingInlineEdits(false);
			await fetchTableData(tab);
		} catch (error) {
			if (!tableRequest.isCurrent()) return;
			console.error("Failed to save inline changes:", error);
			toast.error("Failed to save inline changes", {
				description: error instanceof Error ? error.message : String(error),
			});
		} finally {
			if (tableRequest.isCurrent()) setSavingInlineEdits(false);
		}
	}, [
		connection,
		activeTab,
		pendingInlineEditsByTab,
		fetchTableData,
		requestController,
	]);

	const handleDiscardInlineChanges = useCallback(() => {
		if (!activeTab) return;

		const tab = activeTab;
		const pendingEdits = pendingInlineEditsByTab[tab.id];
		if (!pendingEdits || Object.keys(pendingEdits).length === 0) return;

		setPendingInlineEditsByTab((previous) => {
			const next = { ...previous };
			delete next[tab.id];
			return next;
		});
		toast.info("Inline changes discarded");
	}, [activeTab, pendingInlineEditsByTab]);

	const handleDeleteRow = useCallback(async () => {
		if (!activeTab || !editingRow) return;

		const tab = activeTab;
		const tableRequest = requestController.watchTable(tab.id);
		const [schema, tableName] = tab.tableName.split(".");
		const primaryKeyColumns = tab.columns
			.filter((column) => column.primary_key)
			.map((column) => column.name);
		const primaryKeyValues = primaryKeyColumns.map(
			(column) => editingRow[column],
		);

		if (primaryKeyColumns.length === 0) {
			toast.error("Cannot delete row without primary key");
			return;
		}

		setDeletingRow(true);

		try {
			const result = await api.pool.deleteTableRow(
				connection.uuid,
				schema,
				tableName,
				primaryKeyColumns,
				primaryKeyValues,
			);

			if (!tableRequest.isCurrent()) return;
			if (result.error) {
				toast.error("Failed to delete row", { description: result.error });
			} else {
				toast.success("Row deleted successfully");
				setRowEditSheetOpen(false);
				setEditingRow(null);
				setDeletingRow(false);
				void fetchTableData(tab);
			}
		} catch (error) {
			if (!tableRequest.isCurrent()) return;
			console.error("Failed to delete row:", error);
			toast.error("Failed to delete row", {
				description: error instanceof Error ? error.message : String(error),
			});
		} finally {
			if (tableRequest.isCurrent()) setDeletingRow(false);
		}
	}, [
		connection,
		activeTab,
		editingRow,
		fetchTableData,
		requestController,
	]);

	const handleInsertRow = useCallback(
		async (values: RowMutationValue[]) => {
			if (!activeTab) return;

			const tab = activeTab;
			const tableRequest = requestController.watchTable(tab.id);
			const [schema, tableName] = tab.tableName.split(".");
			setInsertingRow(true);

			try {
				const result = await api.pool.insertTableRow(
					connection.uuid,
					schema,
					tableName,
					values,
				);

				if (!tableRequest.isCurrent()) return;
				if (result.error) {
					toast.error("Failed to insert row", { description: result.error });
				} else {
					toast.success("Row inserted successfully");
					setRowInsertSheetOpen(false);
					setInsertingRow(false);
					void fetchTableData(tab);
				}
			} catch (error) {
				if (!tableRequest.isCurrent()) return;
				console.error("Failed to insert row:", error);
				toast.error("Failed to insert row", {
					description: error instanceof Error ? error.message : String(error),
				});
			} finally {
				if (tableRequest.isCurrent()) setInsertingRow(false);
			}
		},
		[connection, activeTab, fetchTableData, requestController],
	);

	return {
		fetchTableData,
		workspace: {
			savedViews: { changeActive: handleActiveViewChange },
			columnLayout: { change: handleColumnLayoutChange },
			filters: {
				changeState: handleTableFilterStateChange,
				apply: handleApplyFilter,
				clear: clearTableFilter,
				filterCell: handleCellFilter,
				applySavedView: handleApplySavedView,
			},
			data: {
				refresh: handleRefreshTableData,
				changePage: handlePageChange,
				changeSort: handleSortChange,
				selectRow: handleRowClick,
				stageCellEdit: handleInlineCellSave,
			},
			rowEdit: {
				open: rowEditSheetOpen,
				row: editingRow,
				saving: savingRow,
				deleting: deletingRow,
				onOpenChange: handleRowEditOpenChange,
				save: handleSaveRow,
				delete: handleDeleteRow,
			},
			rowInsert: {
				open: rowInsertSheetOpen,
				inserting: insertingRow,
				openSheet: handleOpenRowInsert,
				onOpenChange: handleRowInsertOpenChange,
				insert: handleInsertRow,
			},
			inlineEdits: {
				byTab: pendingInlineEditsByTab,
				saving: savingInlineEdits,
				commit: handleSaveInlineChanges,
				discard: handleDiscardInlineChanges,
			},
			highlightedRow: highlightedTableRow,
		},
		commands: {
			refresh: handleRefreshTableData,
			clearFilter: clearTableFilter,
		},
	};
}

export type TableDataWorkspaceController = ReturnType<
	typeof useTableDataController
>["workspace"];
