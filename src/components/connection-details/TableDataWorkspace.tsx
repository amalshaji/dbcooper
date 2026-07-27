import { ArrowsClockwise, Plus } from "@phosphor-icons/react";
import { RowEditSheet } from "@/components/RowEditSheet";
import { RowInsertSheet } from "@/components/RowInsertSheet";
import { Button } from "@/components/ui/button";
import {
	Card,
	CardContent,
	CardDescription,
	CardHeader,
	CardTitle,
} from "@/components/ui/card";
import { Spinner } from "@/components/ui/spinner";
import type { TableDataWorkspaceController } from "@/hooks/connection-details/useTableDataController";
import { supportsStructuredRowMutations } from "@/lib/databaseCapabilities";
import {
	captureSavedViewState,
	hasUnappliedFilterDraft,
} from "@/lib/savedViews";
import type { SqlConnection } from "@/types/connection";
import type { TableDataTab } from "@/types/tabTypes";
import { ColumnLayoutPopover } from "./ColumnLayoutPopover";
import { SavedViewsMenu } from "./SavedViewsMenu";
import { PendingInlineChangesBar, TableDataGrid } from "./TableDataGrid";
import { TableFilterBar } from "./TableFilterBar";

interface TableDataWorkspaceProps {
	tab: TableDataTab;
	connection: SqlConnection;
	controller: TableDataWorkspaceController;
	onOpenTableDataWithFilter: (
		tableName: string,
		column: string,
		value: unknown,
	) => void;
}

export function TableDataWorkspace({
	tab,
	connection,
	controller,
	onOpenTableDataWithFilter,
}: TableDataWorkspaceProps) {
	const pendingInlineChangeCount = Object.keys(
		controller.inlineEdits.byTab[tab.id] ?? {},
	).length;

	return (
		<>
			<Card className="workspace-panel">
				<CardHeader>
					<div className="flex items-center justify-between">
						<div>
							<CardTitle>{tab.tableName}</CardTitle>
							<CardDescription>
								{tab.data &&
									`Showing ${(tab.currentPage - 1) * 100 + 1}-${Math.min(
										tab.currentPage * 100,
										tab.data.total,
									)} of ${tab.data.total} records`}
							</CardDescription>
						</div>
						<div className="flex items-center gap-2">
							<SavedViewsMenu
								connectionUuid={connection.uuid}
								tableName={tab.tableName}
								currentState={captureSavedViewState(
									tab.filterState.applied,
									tab.sort,
									tab.columnLayout,
								)}
								activeViewId={tab.savedViewId}
								loading={tab.loading}
								hasUnappliedFilterDraft={hasUnappliedFilterDraft(
									tab.filterState.draft,
									tab.filterState.applied,
								)}
								onActiveViewChange={controller.savedViews.changeActive}
								onApply={controller.filters.applySavedView}
							/>
							<ColumnLayoutPopover
								columns={tab.columns.map((column) => column.name)}
								layout={tab.columnLayout}
								onChange={controller.columnLayout.change}
							/>
							{supportsStructuredRowMutations(connection.db_type) && (
								<Button
									variant="default"
									size="sm"
									onClick={controller.rowInsert.openSheet}
									disabled={tab.loading}
								>
									<Plus className="w-4 h-4" />
									Add Row
								</Button>
							)}
							<Button
								variant="outline"
								size="sm"
								onClick={controller.data.refresh}
								disabled={tab.loading}
							>
								{tab.loading ? (
									<Spinner />
								) : (
									<ArrowsClockwise className="w-4 h-4" />
								)}
								Refresh Data
							</Button>
						</div>
					</div>
				</CardHeader>
				<PendingInlineChangesBar
					changeCount={pendingInlineChangeCount}
					saving={controller.inlineEdits.saving}
					loading={tab.loading}
					onDiscard={controller.inlineEdits.discard}
					onCommit={() => void controller.inlineEdits.commit()}
				/>
				<TableFilterBar
					state={tab.filterState}
					columns={tab.columns}
					loading={tab.loading}
					onStateChange={controller.filters.changeState}
					onApply={controller.filters.apply}
					onClear={controller.filters.clear}
				/>
				<CardContent className="max-h-[65vh] flex flex-col">
					<TableDataGrid
						tab={tab}
						dbType={connection.db_type}
						pendingInlineEdits={controller.inlineEdits.byTab[tab.id] ?? {}}
						highlightedRow={controller.highlightedRow}
						onOpenTableDataWithFilter={onOpenTableDataWithFilter}
						onInlineCellSave={controller.data.stageCellEdit}
						onPageChange={controller.data.changePage}
						onRowClick={controller.data.selectRow}
						onCellFilter={controller.filters.filterCell}
						onSortChange={controller.data.changeSort}
						onColumnLayoutChange={controller.columnLayout.change}
					/>
				</CardContent>
			</Card>

			<RowEditSheet
				open={controller.rowEdit.open}
				onOpenChange={controller.rowEdit.onOpenChange}
				tableName={tab.tableName}
				row={controller.rowEdit.row}
				columns={tab.columns}
				dbType={connection.type}
				onSave={controller.rowEdit.save}
				onDelete={controller.rowEdit.delete}
				saving={controller.rowEdit.saving}
				deleting={controller.rowEdit.deleting}
			/>
			<RowInsertSheet
				open={controller.rowInsert.open}
				onOpenChange={controller.rowInsert.onOpenChange}
				tableName={tab.tableName}
				columns={tab.columns}
				dbType={connection.type}
				onInsert={controller.rowInsert.insert}
				inserting={controller.rowInsert.inserting}
			/>
		</>
	);
}
