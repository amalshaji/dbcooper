import { useRef } from "react";
import {
	flexRender,
	getCoreRowModel,
	useReactTable,
	type ColumnDef,
} from "@tanstack/react-table";
import { useVirtualizer } from "@tanstack/react-virtual";
import { Button } from "@/components/ui/button";

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
}

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

	const rowVirtualizer = useVirtualizer({
		count: rows.length,
		getScrollElement: () => containerRef.current,
		estimateSize: () => estimatedRowHeight,
		overscan: 10,
	});

	const virtualRows = rowVirtualizer.getVirtualItems();
	const totalSize = rowVirtualizer.getTotalSize();

	// Calculate padding for virtual scrolling
	const paddingTop = virtualRows.length > 0 ? (virtualRows[0]?.start ?? 0) : 0;
	const paddingBottom =
		virtualRows.length > 0
			? totalSize - (virtualRows[virtualRows.length - 1]?.end ?? 0)
			: 0;

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

		if (virtualize) {
			return (
				<>
					{paddingTop > 0 && (
						<tr>
							<td style={{ height: `${paddingTop}px` }} />
						</tr>
					)}
					{virtualRows.map((virtualRow) => {
						const row = rows[virtualRow.index];
						return (
							<tr
								key={row.id}
								data-index={virtualRow.index}
								ref={(node) => rowVirtualizer.measureElement(node)}
								data-state={row.getIsSelected() && "selected"}
								className={`hover:bg-muted/50 data-[state=selected]:bg-muted border-b transition-colors ${
									onRowClick ? "cursor-pointer" : ""
								}`}
								onClick={() => onRowClick?.(row.original)}
							>
								{row.getVisibleCells().map((cell) => (
									<td
										key={cell.id}
										className="p-3 align-middle whitespace-nowrap max-w-[400px] overflow-hidden text-ellipsis"
									>
										{flexRender(cell.column.columnDef.cell, cell.getContext())}
									</td>
								))}
							</tr>
						);
					})}
					{paddingBottom > 0 && (
						<tr>
							<td style={{ height: `${paddingBottom}px` }} />
						</tr>
					)}
				</>
			);
		}

		// Non-virtualized rendering (original behavior)
		return rows.map((row) => (
			<tr
				key={row.id}
				data-state={row.getIsSelected() && "selected"}
				className={`hover:bg-muted/50 data-[state=selected]:bg-muted border-b transition-colors ${
					onRowClick ? "cursor-pointer" : ""
				}`}
				onClick={() => onRowClick?.(row.original)}
			>
				{row.getVisibleCells().map((cell) => (
					<td key={cell.id} className="p-3 align-middle whitespace-nowrap max-w-[400px] overflow-hidden text-ellipsis">
						{flexRender(cell.column.columnDef.cell, cell.getContext())}
					</td>
				))}
			</tr>
		));
	};

	return (
		<div className="flex flex-col h-full w-full min-w-0">
			<div
				ref={containerRef}
				className="rounded-md border overflow-auto w-full h-full"
			>
				<table className="w-full caption-bottom text-xs">
					<thead className="sticky top-0 bg-background z-10 shadow-sm">
						{table.getHeaderGroups().map((headerGroup) => (
							<tr key={headerGroup.id} className="border-b">
								{headerGroup.headers.map((header) => (
									<th
										key={header.id}
										className="text-foreground h-12 px-3 text-left align-middle font-medium whitespace-nowrap bg-background"
									>
										{header.isPlaceholder
											? null
											: flexRender(
													header.column.columnDef.header,
													header.getContext(),
												)}
									</th>
								))}
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
