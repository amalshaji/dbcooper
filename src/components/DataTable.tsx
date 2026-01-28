import { useRef, useMemo, useCallback } from "react";
import {
	flexRender,
	getCoreRowModel,
	useReactTable,
	type ColumnDef,
} from "@tanstack/react-table";
import { useVirtualizer } from "@tanstack/react-virtual";
import { Button } from "@/components/ui/button";
import { CaretUp, CaretDown, CaretUpDown } from "@phosphor-icons/react";

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
}

const COLUMN_WIDTH = 150;
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
}: DataTableProps<TData>) {
	const containerRef = useRef<HTMLDivElement>(null);

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
	const shouldVirtualizeRows = virtualize && rows.length > 50;

	const rowVirtualizer = useVirtualizer({
		count: rows.length,
		getScrollElement: () => containerRef.current,
		estimateSize: () => estimatedRowHeight,
		overscan: 10,
		enabled: shouldVirtualizeRows,
	});

	const columnVirtualizer = useVirtualizer({
		horizontal: true,
		count: visibleColumns.length,
		getScrollElement: () => containerRef.current,
		estimateSize: () => COLUMN_WIDTH,
		overscan: 3,
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

			return (
				<td
					key={cell.id}
					style={{
						width: COLUMN_WIDTH,
						minWidth: MIN_COLUMN_WIDTH,
						maxWidth: MAX_COLUMN_WIDTH,
					}}
					className="p-3 align-middle whitespace-nowrap overflow-hidden text-ellipsis box-border"
				>
					{flexRender(cell.column.columnDef.cell, cell.getContext())}
				</td>
			);
		},
		[],
	);

	const renderTableBody = () => {
		if (!rows.length) {
			return (
				<tr>
					<td colSpan={columns.length} className="h-32 text-center p-3">
						No results.
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
					return (
						<tr
							key={row.id}
							data-index={virtualRow.index}
							ref={measureRowElement}
							data-state={row.getIsSelected() && "selected"}
							className={`hover:bg-muted/50 data-[state=selected]:bg-muted border-b transition-colors ${
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
	}, [
		shouldVirtualizeColumns,
		totalColumnWidth,
		visibleColumns.length,
	]);

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
			<div
				ref={containerRef}
				className="rounded-md border overflow-auto w-full"
			>
				<table
					className="caption-bottom text-xs border-collapse"
					style={{
						width: tableWidth,
						minWidth: "100%",
						tableLayout: "fixed",
					}}
				>
					<thead className="sticky top-0 bg-background z-10 shadow-sm">
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
											className={`text-foreground h-12 px-3 text-left align-middle font-medium whitespace-nowrap bg-background overflow-hidden text-ellipsis box-border ${
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
			</div>

			{!hidePagination && (
				<div className="flex items-center justify-between px-2 pt-3 pb-1">
					<div className="text-sm text-muted-foreground">
						Page {currentPage} of {pageCount}
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
