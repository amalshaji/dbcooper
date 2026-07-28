import {
	ArrowCounterClockwise,
	CaretDown,
	CaretUp,
	Columns,
	DotsSixVertical,
} from "@phosphor-icons/react";
import { useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import {
	Popover,
	PopoverContent,
	PopoverDescription,
	PopoverHeader,
	PopoverTitle,
	PopoverTrigger,
} from "@/components/ui/popover";
import {
	createColumnLayout,
	moveColumn,
	reorderColumn,
	type TableColumnLayout,
} from "../../lib/savedViews";

interface ColumnLayoutPopoverProps {
	columns: string[];
	layout: TableColumnLayout;
	onChange: (layout: TableColumnLayout) => void;
}

export function ColumnLayoutPopover({
	columns,
	layout,
	onChange,
}: ColumnLayoutPopoverProps) {
	const dragColumn = useRef<string | null>(null);
	const [draggingColumn, setDraggingColumn] = useState<string | null>(null);
	const orderedColumns = layout.columnOrder.filter((column) =>
		columns.includes(column),
	);
	for (const column of columns) {
		if (!orderedColumns.includes(column)) orderedColumns.push(column);
	}
	const visibleCount = columns.length - layout.hiddenColumns.length;

	const setColumnVisibility = (column: string, visible: boolean) => {
		if (!visible && visibleCount <= 1) return;
		const hiddenColumns = visible
			? layout.hiddenColumns.filter((item) => item !== column)
			: [...layout.hiddenColumns, column];
		onChange({ ...layout, hiddenColumns });
	};

	const handlePointerMove = (event: React.PointerEvent<HTMLButtonElement>) => {
		const column = dragColumn.current;
		if (!column || !document.elementsFromPoint) return;
		const row = document
			.elementsFromPoint(event.clientX, event.clientY)
			.map((element) => element.closest<HTMLElement>("[data-column-name]"))
			.find(Boolean);
		const target = row?.dataset.columnName;
		if (!target || target === column) return;
		onChange({
			...layout,
			columnOrder: reorderColumn(orderedColumns, column, target),
		});
	};

	const finishDrag = (event: React.PointerEvent<HTMLButtonElement>) => {
		if (event.currentTarget.hasPointerCapture(event.pointerId)) {
			event.currentTarget.releasePointerCapture(event.pointerId);
		}
		dragColumn.current = null;
		setDraggingColumn(null);
	};

	return (
		<Popover>
			<PopoverTrigger
				render={<Button variant="outline" size="sm" disabled={!columns.length} />}
			>
				<Columns className="size-4" />
				Columns
			</PopoverTrigger>
			<PopoverContent align="end" className="w-80 gap-0 p-0">
				<PopoverHeader className="border-b px-3 py-3">
					<PopoverTitle>Table columns</PopoverTitle>
					<PopoverDescription>
						Drag to reorder, or use the arrow buttons.
					</PopoverDescription>
				</PopoverHeader>
				<div className="max-h-72 overflow-y-auto p-1.5">
					{orderedColumns.map((column, index) => {
						const visible = !layout.hiddenColumns.includes(column);
						return (
							<div
								key={column}
								data-column-name={column}
								data-dragging={draggingColumn === column || undefined}
								className="group/column flex h-9 items-center rounded-lg px-1.5 text-xs transition-colors hover:bg-muted/70 data-[dragging=true]:bg-primary/8 data-[dragging=true]:text-foreground"
							>
								<button
									type="button"
									aria-label={`Drag to reorder ${column} column`}
									className="mr-1 flex size-7 touch-none cursor-grab items-center justify-center rounded-md text-muted-foreground outline-none active:cursor-grabbing active:scale-95 focus-visible:ring-1 focus-visible:ring-ring"
									onPointerDown={(event) => {
										dragColumn.current = column;
										setDraggingColumn(column);
										event.currentTarget.setPointerCapture(event.pointerId);
									}}
									onPointerMove={handlePointerMove}
									onPointerUp={finishDrag}
									onPointerCancel={finishDrag}
								>
									<DotsSixVertical className="size-4" />
								</button>
								<label className="flex min-w-0 flex-1 cursor-pointer items-center">
									<Checkbox
										checked={visible}
										disabled={visible && visibleCount <= 1}
										onCheckedChange={(checked) =>
											setColumnVisibility(column, checked === true)
										}
										aria-label={`Show ${column} column`}
									/>
									<span className="ml-2 truncate font-mono">{column}</span>
								</label>
								<div className="flex opacity-0 transition-opacity group-hover/column:opacity-100 focus-within:opacity-100">
									<Button
										variant="ghost"
										size="icon-sm"
										disabled={index === 0}
										aria-label={`Move ${column} column up`}
										onClick={() =>
											onChange({
												...layout,
												columnOrder: moveColumn(orderedColumns, column, -1),
											})
										}
									>
										<CaretUp className="size-3.5" />
									</Button>
									<Button
										variant="ghost"
										size="icon-sm"
										disabled={index === orderedColumns.length - 1}
										aria-label={`Move ${column} column down`}
										onClick={() =>
											onChange({
												...layout,
												columnOrder: moveColumn(orderedColumns, column, 1),
											})
										}
									>
										<CaretDown className="size-3.5" />
									</Button>
								</div>
							</div>
						);
					})}
				</div>
				<div className="border-t p-1.5">
					<Button
						variant="ghost"
						size="sm"
						className="w-full justify-start text-muted-foreground"
						onClick={() => onChange(createColumnLayout(columns))}
					>
						<ArrowCounterClockwise className="size-4" />
						Reset columns
					</Button>
				</div>
			</PopoverContent>
		</Popover>
	);
}
