import { useMemo } from "react";
import { ArrowRight, FloppyDisk, X } from "@phosphor-icons/react";
import type { ColumnDef } from "@tanstack/react-table";
import { DataTable } from "@/components/DataTable";
import { InlineEditableCell } from "@/components/InlineEditableCell";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Spinner } from "@/components/ui/spinner";
import { supportsStructuredRowMutations } from "@/lib/databaseCapabilities";
import { getPrimaryKeyRowKey } from "@/lib/connection-details/queryTableState";
import type { TableColumnLayout } from "@/lib/savedViews";
import type { ConnectionType } from "@/types/connection";
import type { SortConfig, TableDataTab } from "@/types/tabTypes";

interface PendingInlineCellEdit {
	row: Record<string, unknown>;
	columnName: string;
	value: unknown;
}

export function PendingInlineChangesBar({
	changeCount,
	saving,
	loading,
	onDiscard,
	onCommit,
}: {
	changeCount: number;
	saving: boolean;
	loading: boolean;
	onDiscard: () => void;
	onCommit: () => void;
}) {
	if (changeCount === 0) return null;

	return (
		<div className="mx-6 flex items-center justify-between rounded-lg border border-primary/30 bg-primary/5 px-3 py-2">
			<span className="text-xs font-medium text-foreground">
				Unsaved changes
			</span>
			<div className="flex items-center gap-2">
				<Button
					variant="outline"
					size="sm"
					onClick={onDiscard}
					disabled={saving || loading}
				>
					<X className="w-4 h-4" />
					Discard
				</Button>
				<Button size="sm" onClick={onCommit} disabled={saving || loading}>
					{saving ? <Spinner /> : <FloppyDisk className="w-4 h-4" />}
					Commit
				</Button>
			</div>
		</div>
	);
}

export function TableDataGrid({
	tab,
	dbType,
	pendingInlineEdits,
	highlightedRow,
	onOpenTableDataWithFilter,
	onInlineCellSave,
	onPageChange,
	onRowClick,
	onCellFilter,
	onSortChange,
	onColumnLayoutChange,
}: {
	tab: TableDataTab;
	dbType: ConnectionType;
	pendingInlineEdits: Record<string, PendingInlineCellEdit>;
	highlightedRow: { tableName: string; rowKey: string } | null;
	onOpenTableDataWithFilter: (
		tableName: string,
		column: string,
		value: unknown,
	) => void;
	onInlineCellSave: (
		row: Record<string, unknown>,
		columnName: string,
		value: unknown,
	) => Promise<void>;
	onPageChange: (page: number) => void;
	onRowClick: (row: Record<string, unknown>) => void;
	onCellFilter: (column: string, value: unknown, exclude: boolean) => void;
	onSortChange: (sort: SortConfig | null) => void;
	onColumnLayoutChange: (layout: TableColumnLayout) => void;
}) {
	const columns = useMemo<ColumnDef<Record<string, unknown>>[]>(() => {
		if (!tab.data || tab.data.data.length === 0) return [];

		const schema = tab.tableName.split(".")[0];
		const firstRow = tab.data.data[0];
		const hasPrimaryKey = tab.columns.some((column) => column.primary_key);
		return Object.keys(firstRow).map((key) => {
			const foreignKey = tab.foreignKeys.find((item) => item.column === key);
			const column = tab.columns.find((item) => item.name === key);

			return {
				accessorKey: key,
				header: () => (
					<span className="flex flex-col">
						<span className="flex items-center gap-1">
							{key}
							{foreignKey && (
								<span className="text-[10px] text-muted-foreground">(FK)</span>
							)}
						</span>
						{column && (
							<span
								className="text-[10px] text-muted-foreground truncate max-w-[150px]"
								title={column.type}
							>
								{column.type}
							</span>
						)}
					</span>
				),
				cell: ({ getValue, row }) => {
					const originalValue = getValue();
					const rowKey = getPrimaryKeyRowKey(row.original, tab.columns);
					const pendingEdit = rowKey
						? pendingInlineEdits[`${rowKey}:${key}`]
						: undefined;
					const value = pendingEdit ? pendingEdit.value : originalValue;
					const nullContent =
						value === null ? (
							<span className="text-muted-foreground italic">null</span>
						) : null;
					const rawValue =
						typeof value === "object" ? JSON.stringify(value) : String(value);
					const displayValue =
						rawValue.length > 200 ? `${rawValue.slice(0, 200)}…` : rawValue;
					const canEditInline =
						!!column &&
						!column.primary_key &&
						hasPrimaryKey &&
						supportsStructuredRowMutations(dbType);

					const content =
						nullContent ??
						(foreignKey && value !== null ? (
							<span className="group/fk flex items-center" title={rawValue}>
								<span className="truncate">{displayValue}</span>
								<button
									type="button"
									className="opacity-0 group-hover/fk:opacity-100 p-0.5 rounded hover:bg-muted transition-opacity cursor-pointer"
									onClick={(event) => {
										event.stopPropagation();
										onOpenTableDataWithFilter(
											`${schema}.${foreignKey.references_table}`,
											foreignKey.references_column,
											value,
										);
									}}
									title={`View ${foreignKey.references_table} where ${foreignKey.references_column} = ${value}`}
								>
									<ArrowRight className="w-3.5 h-3.5 text-primary" />
								</button>
							</span>
						) : (
							<span title={rawValue}>{displayValue}</span>
						));

					return column ? (
						<InlineEditableCell
							value={value}
							column={column}
							disabled={!canEditInline}
							onSave={(nextValue) =>
								onInlineCellSave(row.original, key, nextValue)
							}
						>
							{pendingEdit ? (
								<span className="text-primary font-medium">{content}</span>
							) : (
								content
							)}
						</InlineEditableCell>
					) : (
						content
					);
				},
			};
		});
	}, [
		tab,
		dbType,
		pendingInlineEdits,
		onOpenTableDataWithFilter,
		onInlineCellSave,
	]);

	if (tab.loading) {
		return (
			<div className="space-y-3 h-full overflow-auto">
				<div className="flex items-center gap-2">
					{[...Array(5)].map((_, index) => (
						<Skeleton key={index} className="h-8 flex-1 rounded" />
					))}
				</div>
				{[...Array(20)].map((_, rowIndex) => (
					<div key={rowIndex} className="flex items-center gap-2">
						{[...Array(5)].map((_, columnIndex) => (
							<Skeleton key={columnIndex} className="h-6 flex-1 rounded" />
						))}
					</div>
				))}
			</div>
		);
	}

	if (!tab.data || tab.data.data.length === 0) {
		return (
			<div className="flex min-h-40 items-center justify-center px-4 text-center">
				<p className="text-sm text-muted-foreground">
					No rows found in this table.
				</p>
			</div>
		);
	}

	return (
		<div className="h-[65vh] overflow-hidden">
			<DataTable
				data={tab.data.data}
				columns={columns}
				pageCount={Math.ceil(tab.data.total / tab.data.limit)}
				currentPage={tab.currentPage}
				onPageChange={onPageChange}
				onRowClick={onRowClick}
				virtualize
				onCellFilter={onCellFilter}
				sortable
				sort={tab.sort}
				onSortChange={onSortChange}
				isRowHighlighted={(row) =>
					highlightedRow?.tableName === tab.tableName &&
					getPrimaryKeyRowKey(row, tab.columns) === highlightedRow.rowKey
				}
				columnLayout={tab.columnLayout}
				onColumnLayoutChange={onColumnLayoutChange}
			/>
		</div>
	);
}
