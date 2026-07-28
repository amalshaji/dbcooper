import type { MouseEvent, TouchEvent } from "react";
import {
	DEFAULT_COLUMN_WIDTH,
	MAX_COLUMN_WIDTH,
	MIN_COLUMN_WIDTH,
} from "../../lib/savedViews";

interface ColumnResizeHandleProps {
	columnLabel: string;
	width: number;
	isResizing: boolean;
	onResizeStart: (event: MouseEvent | TouchEvent) => void;
	onWidthChange: (width: number) => void;
}

export function ColumnResizeHandle({
	columnLabel,
	width,
	isResizing,
	onResizeStart,
	onWidthChange,
}: ColumnResizeHandleProps) {
	return (
		<div
			role="separator"
			aria-orientation="vertical"
			aria-label={`Resize ${columnLabel} column`}
			aria-valuemin={MIN_COLUMN_WIDTH}
			aria-valuemax={MAX_COLUMN_WIDTH}
			aria-valuenow={width}
			tabIndex={0}
			className="absolute inset-y-0 right-0 z-20 w-2 cursor-col-resize touch-none outline-none after:absolute after:inset-y-2 after:right-0 after:w-px after:bg-border after:opacity-0 after:transition-opacity hover:after:opacity-100 focus-visible:after:bg-ring focus-visible:after:opacity-100 data-[resizing=true]:after:bg-primary data-[resizing=true]:after:opacity-100"
			data-resizing={isResizing}
			onClick={(event) => event.stopPropagation()}
			onDoubleClick={(event) => {
				event.stopPropagation();
				onWidthChange(DEFAULT_COLUMN_WIDTH);
			}}
			onMouseDown={(event) => {
				event.stopPropagation();
				onResizeStart(event);
			}}
			onTouchStart={(event) => {
				event.stopPropagation();
				onResizeStart(event);
			}}
			onKeyDown={(event) => {
				if (event.key !== "ArrowLeft" && event.key !== "ArrowRight") return;
				event.preventDefault();
				event.stopPropagation();
				const step = event.shiftKey ? 25 : 10;
				onWidthChange(width + (event.key === "ArrowRight" ? step : -step));
			}}
		/>
	);
}
