import {
	CaretDown,
	CaretUp,
	CaretUpDown,
	MagnifyingGlass,
} from "@phosphor-icons/react";
import {
	type ColumnDef,
	flexRender,
	getCoreRowModel,
	useReactTable,
} from "@tanstack/react-table";
import { useVirtualizer } from "@tanstack/react-virtual";
import { useCallback, useMemo, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import {
	ContextMenu,
	ContextMenuContent,
	ContextMenuItem,
	ContextMenuTrigger,
} from "@/components/ui/context-menu";

export interface SortState {
	column: string;
	direction: "asc" | "desc";
}

interface DataTableProps<TData> {
	data: TData[];
	columns: ColumnDef<TData>[];
	pageCount?: number;
	currentPage?: number;
	onPageChange?: (page: number) => void;
	onRowClick?: (row: TData) => void;
	hidePagination?: boolean;
	virtualize?: boolean;
	estimatedRowHeight?: number;
	sortable?: boolean;
	sort?: SortState | null;
	onSortChange?: (sort: SortState | null) => void;
	isRowHighlighted?: (row: TData) => boolean;
	onCellFilter?: (column: string, value: unknown, exclude: boolean) => void;
}

const COLUMN_WIDTH = 150;
const VISIBLE_ROW_CAPACITY = 30;
const MIN_COLUMN_WIDTH = 80;
const MAX_COLUMN_WIDTH = 300;

export function DataTable<TData>({
	data,
	columns,
	pageCount = 1,
	currentPage = 1,
	onPageChange,
	onRowClick,
	hidePagination = false,
	virtualize = false,
	estimatedRowHeight = 41,
	sortable = false,
	sort = null,
	onSortChange,
	isRowHighlighted,
	onCellFilter,
}: DataTableProps<TData>) {
	const containerRef = useRef<HTMLDivElement>(null);
	const [contextCell, setContextCell] = useState<{
		column: string;
		value: unknown;
	} | null>(null);

	// TanStack Table returns functions that cannot be safely memoized by React Compiler.
	// eslint-disable-next-line react-hooks/incompatible-library
	const table = useReactTable({
		data,
		columns,
		getCoreRowModel: getCoreRowModel(),
		manualPagination: true,
		pageCount,
	});

	const { rows } = table.getRowModel();
	const headerGroups = table.getHeaderGroups();
	const visibleColumns = headerGroups[0]?.headers ?? [];

	const shouldVirtualizeColumns = visibleColumns.length > 20;
	const shouldVirtualizeRows = virtualize && rows.length > VISIBLE_ROW_CAPACITY;

	const rowVirtualizer = useVirtualizer({
		count: rows.length,
		getScrollElement: () => containerRef.current,
		estimateSize: () => estimatedRowHeight,
		overscan: 12,
		enabled: shouldVirtualizeRows,
	});

	const columnVirtualizer = useVirtualizer({
		horizontal: true,
		count: visibleColumns.length,
		getScrollElement: () => containerRef.current,
		estimateSize: () => COLUMN_WIDTH,
		overscan: 4,
		enabled: shouldVirtualizeColumns,
	});

	const virtualRows = shouldVirtualizeRows
		? rowVirtualizer.getVirtualItems()
		: rows.map((_, index) => ({
				index,
				start: index * estimatedRowHeight,
				end: (index + 1) * estimatedRowHeight,
				size: estimatedRowHeight,
				key: index,
			}));

	const virtualColumns = shouldVirtualizeColumns
		? columnVirtualizer.getVirtualItems()
		: visibleColumns.map((_, index) => ({
				index,
				start: index * COLUMN_WIDTH,
				end: (index + 1) * COLUMN_WIDTH,
				size: COLUMN_WIDTH,
				key: index,
			}));

	const totalRowHeight = shouldVirtualizeRows
		? rowVirtualizer.getTotalSize()
		: rows.length * estimatedRowHeight;

	const totalColumnWidth = shouldVirtualizeColumns
		? columnVirtualizer.getTotalSize()
		: visibleColumns.length * COLUMN_WIDTH;

	const paddingTop =
		shouldVirtualizeRows && virtualRows.length > 0
			? (virtualRows[0]?.start ?? 0)
			: 0;
	const paddingBottom =
		shouldVirtualizeRows && virtualRows.length > 0
			? totalRowHeight - (virtualRows[virtualRows.length - 1]?.end ?? 0)
			: 0;
	const paddingLeft =
		shouldVirtualizeColumns && virtualColumns.length > 0
			? (virtualColumns[0]?.start ?? 0)
			: 0;
	const paddingRight =
		shouldVirtualizeColumns && virtualColumns.length > 0
			? totalColumnWidth - (virtualColumns[virtualColumns.length - 1]?.end ?? 0)
			: 0;

	const measureRowElement = useCallback(
		(node: HTMLTableRowElement | null) => {
			if (shouldVirtualizeRows && node) {
				// Get the index from the data-index attribute to properly measure this specific row
				const index = node.getAttribute("data-index");
				if (index !== null) {
					rowVirtualizer.measureElement(node);
				}
			}
		},
		[shouldVirtualizeRows, rowVirtualizer],
	);

	const handleHeaderClick = useCallback(
		(columnId: string) => {
			if (!sortable || !onSortChange) return;

			if (sort?.column === columnId) {
				if (sort.direction === "asc") {
					onSortChange({ column: columnId, direction: "desc" });
				} else {
					onSortChange(null);
				}
			} else {
				onSortChange({ column: columnId, direction: "asc" });
			}
		},
		[sortable, sort, onSortChange],
	);

	const renderCell = useCallback(
		(row: (typeof rows)[number], columnIndex: number) => {
			const cell = row.getVisibleCells()[columnIndex];
			if (!cell) return null;

			const cellProps = {
				style: {
					width: COLUMN_WIDTH,
					minWidth: MIN_COLUMN_WIDTH,
					maxWidth: MAX_COLUMN_WIDTH,
				},
				className:
					"h-10 px-3 align-middle whitespace-nowrap overflow-hidden text-ellipsis box-border",
			};
			const content = flexRender(cell.column.columnDef.cell, cell.getContext());

			return (
				<td
					key={cell.id}
					{...cellProps}
					onContextMenu={
						onCellFilter
							? () =>
									setContextCell({
										column: cell.column.id,
										value: cell.getValue(),
									})
							: undefined
					}
				>
					{content}
				</td>
			);
		},
		[onCellFilter],
	);

	const renderTableBody = () => {
		if (!rows.length) {
			return (
				<tr>
					<td colSpan={columns.length} className="p-3">
						<div className="flex flex-col items-center justify-center gap-2 py-10 text-center">
							<div className="flex size-9 items-center justify-center rounded-lg bg-muted text-muted-foreground/70 ring-1 ring-border">
								<MagnifyingGlass className="size-4" />
							</div>
							<div className="space-y-0.5">
								<p className="text-sm font-medium text-foreground">
									No results
								</p>
								<p className="text-xs text-muted-foreground">
									Nothing to show for this query.
								</p>
							</div>
						</div>
					</td>
				</tr>
			);
		}

		return (
			<>
				{paddingTop > 0 && (
					<tr style={{ height: paddingTop }}>
						<td />
					</tr>
				)}
				{virtualRows.map((virtualRow) => {
					const row = rows[virtualRow.index];
					const highlighted = isRowHighlighted?.(row.original) ?? false;
					return (
						<tr
							key={row.id}
							data-index={virtualRow.index}
							ref={measureRowElement}
							data-state={row.getIsSelected() && "selected"}
							data-highlighted={highlighted ? "true" : undefined}
							className={`border-b transition-colors hover:bg-muted/40 data-[state=selected]:bg-muted data-[highlighted=true]:bg-primary/5 ${
								onRowClick ? "cursor-pointer" : ""
							}`}
							onClick={() => onRowClick?.(row.original)}
						>
							{paddingLeft > 0 && (
								<td style={{ width: paddingLeft, minWidth: paddingLeft }} />
							)}
							{virtualColumns.map((virtualColumn) =>
								renderCell(row, virtualColumn.index),
							)}
							{paddingRight > 0 && (
								<td style={{ width: paddingRight, minWidth: paddingRight }} />
							)}
						</tr>
					);
				})}
				{paddingBottom > 0 && (
					<tr style={{ height: paddingBottom }}>
						<td />
					</tr>
				)}
			</>
		);
	};

	const tableWidth = useMemo(() => {
		if (shouldVirtualizeColumns) {
			return totalColumnWidth;
		}
		return Math.max(visibleColumns.length * COLUMN_WIDTH, 100);
	}, [shouldVirtualizeColumns, totalColumnWidth, visibleColumns.length]);

	const getSortIcon = (columnId: string) => {
		if (!sortable) return null;

		if (sort?.column === columnId) {
			return sort.direction === "asc" ? (
				<CaretUp className="w-3.5 h-3.5 ml-1" />
			) : (
				<CaretDown className="w-3.5 h-3.5 ml-1" />
			);
		}
		return <CaretUpDown className="w-3.5 h-3.5 ml-1 opacity-40" />;
	};

	return (
		<div className="flex flex-col max-h-full w-full min-w-0">
			<ContextMenu>
				<ContextMenuTrigger
					render={
						<div
							ref={containerRef}
							className="w-full overflow-auto rounded-md border bg-card"
						/>
					}
				>
					<table
						className="caption-bottom border-collapse text-xs tabular-figures"
						style={{
							width: tableWidth,
							minWidth: "100%",
							tableLayout: "fixed",
						}}
					>
						<thead className="sticky top-0 z-10 bg-muted/60 backdrop-blur-sm">
							{headerGroups.map((headerGroup) => (
								<tr key={headerGroup.id} className="border-b">
									{paddingLeft > 0 && (
										<th
											style={{ width: paddingLeft, minWidth: paddingLeft }}
											className="bg-background"
										/>
									)}
									{virtualColumns.map((virtualColumn) => {
										const header = headerGroup.headers[virtualColumn.index];
										if (!header) return null;
										const columnDef = header.column.columnDef;
										const columnId =
											"accessorKey" in columnDef &&
											typeof columnDef.accessorKey === "string"
												? columnDef.accessorKey
												: header.id;
										return (
											<th
												key={header.id}
												style={{
													width: COLUMN_WIDTH,
													minWidth: MIN_COLUMN_WIDTH,
													maxWidth: MAX_COLUMN_WIDTH,
												}}
												className={`h-10 overflow-hidden text-ellipsis whitespace-nowrap bg-transparent px-3 text-left align-middle font-medium text-foreground box-border ${
													sortable
														? "cursor-pointer hover:bg-muted/50 select-none"
														: ""
												}`}
												onClick={() => handleHeaderClick(columnId)}
											>
												<div className="flex items-center">
													<span className="truncate">
														{header.isPlaceholder
															? null
															: flexRender(
																	header.column.columnDef.header,
																	header.getContext(),
																)}
													</span>
													{getSortIcon(columnId)}
												</div>
											</th>
										);
									})}
									{paddingRight > 0 && (
										<th
											style={{ width: paddingRight, minWidth: paddingRight }}
											className="bg-background"
										/>
									)}
								</tr>
							))}
						</thead>
						<tbody className="[&_tr:last-child]:border-0">
							{renderTableBody()}
						</tbody>
					</table>
				</ContextMenuTrigger>
				{onCellFilter && contextCell && (
					<ContextMenuContent>
						<ContextMenuItem
							onClick={() =>
								onCellFilter(contextCell.column, contextCell.value, false)
							}
						>
							Filter by this value
						</ContextMenuItem>
						<ContextMenuItem
							onClick={() =>
								onCellFilter(contextCell.column, contextCell.value, true)
							}
						>
							Exclude this value
						</ContextMenuItem>
					</ContextMenuContent>
				)}
			</ContextMenu>

			{!hidePagination && (
				<div className="flex items-center justify-between px-1 pb-1 pt-3">
					<div className="text-xs text-muted-foreground tabular-figures">
						Page{" "}
						<span className="font-medium text-foreground">{currentPage}</span>{" "}
						of <span className="font-medium text-foreground">{pageCount}</span>
					</div>
					<div className="flex items-center space-x-2">
						<Button
							variant="outline"
							size="sm"
							onClick={() => onPageChange?.(currentPage - 1)}
							disabled={currentPage === 1}
						>
							Previous
						</Button>
						<Button
							variant="outline"
							size="sm"
							onClick={() => onPageChange?.(currentPage + 1)}
							disabled={currentPage >= pageCount}
						>
							Next
						</Button>
					</div>
				</div>
			)}
		</div>
	);
}
