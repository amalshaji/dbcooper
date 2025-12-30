import { useRef } from "react";
import {
	flexRender,
	getCoreRowModel,
	useReactTable,
	type ColumnDef,
} from "@tanstack/react-table";
import { Button } from "@/components/ui/button";

interface DataTableProps<TData> {
	data: TData[];
	columns: ColumnDef<TData>[];
	pageCount?: number;
	currentPage?: number;
	onPageChange?: (page: number) => void;
	onRowClick?: (row: TData) => void;
	hidePagination?: boolean;
}

export function DataTable<TData>({
	data,
	columns,
	pageCount = 1,
	currentPage = 1,
	onPageChange,
	onRowClick,
	hidePagination = false,
}: DataTableProps<TData>) {
	const containerRef = useRef<HTMLDivElement>(null);

	const table = useReactTable({
		data,
		columns,
		getCoreRowModel: getCoreRowModel(),
		manualPagination: true,
		pageCount,
	});

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
						{table.getRowModel().rows?.length ? (
							table.getRowModel().rows.map((row) => (
								<tr
									key={row.id}
									data-state={row.getIsSelected() && "selected"}
									className={`hover:bg-muted/50 data-[state=selected]:bg-muted border-b transition-colors ${
										onRowClick ? "cursor-pointer" : ""
									}`}
									onClick={() => onRowClick?.(row.original)}
								>
									{row.getVisibleCells().map((cell) => (
										<td
											key={cell.id}
											className="p-3 align-middle whitespace-nowrap"
										>
											{flexRender(
												cell.column.columnDef.cell,
												cell.getContext(),
											)}
										</td>
									))}
								</tr>
							))
						) : (
							<tr>
								<td colSpan={columns.length} className="h-32 text-center p-3">
									No results.
								</td>
							</tr>
						)}
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
