import {
	ArrowCounterClockwise,
	Check,
	PencilSimple,
} from "@phosphor-icons/react";
import { type ReactNode, useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Spinner } from "@/components/ui/spinner";
import type { TableColumn } from "@/types/tabTypes";

interface InlineEditableCellProps {
	value: unknown;
	column: TableColumn;
	disabled?: boolean;
	children: ReactNode;
	onSave: (value: unknown) => Promise<void>;
}

function stringifyCellValue(value: unknown): string {
	if (value === null || value === undefined) return "NULL";
	if (typeof value === "object") return JSON.stringify(value);
	return String(value);
}

function isNumericType(columnType: string): boolean {
	return (
		columnType.includes("int") ||
		columnType.includes("numeric") ||
		columnType.includes("decimal") ||
		columnType.includes("real") ||
		columnType.includes("double") ||
		columnType.includes("float") ||
		columnType === "serial" ||
		columnType === "bigserial"
	);
}

function parseCellValue(text: string, column: TableColumn): unknown {
	const trimmed = text.trim();
	const columnType = column.type.toLowerCase();

	if (trimmed.toLowerCase() === "null") {
		return null;
	}

	if (columnType === "boolean" || columnType === "bool") {
		if (["true", "1", "yes"].includes(trimmed.toLowerCase())) return true;
		if (["false", "0", "no"].includes(trimmed.toLowerCase())) return false;
		throw new Error("Boolean values must be true or false");
	}

	if (isNumericType(columnType)) {
		if (trimmed === "") return null;
		const numericValue = Number(trimmed);
		if (Number.isNaN(numericValue)) {
			throw new Error("Numeric values must be valid numbers");
		}
		return numericValue;
	}

	if (columnType.includes("json")) {
		if (trimmed === "") return null;
		try {
			return JSON.parse(trimmed);
		} catch {
			throw new Error("JSON values must be valid JSON");
		}
	}

	return text;
}

export function InlineEditableCell({
	value,
	column,
	disabled = false,
	children,
	onSave,
}: InlineEditableCellProps) {
	const [editing, setEditing] = useState(false);
	const [draftValue, setDraftValue] = useState(stringifyCellValue(value));
	const [saving, setSaving] = useState(false);
	const inputRef = useRef<HTMLInputElement>(null);
	const editorRef = useRef<HTMLDivElement>(null);

	useEffect(() => {
		if (!editing) {
			setDraftValue(stringifyCellValue(value));
		}
	}, [value, editing]);

	useEffect(() => {
		if (editing) {
			inputRef.current?.focus();
			inputRef.current?.select();
		}
	}, [editing]);

	const commit = async () => {
		if (saving) return;

		let parsedValue: unknown;
		try {
			parsedValue = parseCellValue(draftValue, column);
		} catch (error) {
			toast.error("Invalid cell value", {
				description: error instanceof Error ? error.message : String(error),
			});
			return;
		}

		if (JSON.stringify(parsedValue) === JSON.stringify(value)) {
			setEditing(false);
			return;
		}

		setSaving(true);
		try {
			await onSave(parsedValue);
			setEditing(false);
		} finally {
			setSaving(false);
		}
	};

	const reset = () => {
		setDraftValue(stringifyCellValue(value));
		setEditing(false);
	};

	const handleEditorBlur = () => {
		window.requestAnimationFrame(() => {
			if (!editorRef.current?.contains(document.activeElement)) {
				reset();
			}
		});
	};

	if (editing) {
		return (
			<div ref={editorRef} className="flex min-w-48 items-center">
				<Input
					ref={inputRef}
					value={draftValue}
					onChange={(event) => setDraftValue(event.target.value)}
					onKeyDown={(event) => {
						if (event.key === "Enter") {
							event.preventDefault();
							void commit();
						}
						if (event.key === "Escape") {
							event.preventDefault();
							setDraftValue(stringifyCellValue(value));
							setEditing(false);
						}
					}}
					disabled={saving}
					className="h-7 min-w-0"
					onBlur={handleEditorBlur}
					onClick={(event) => event.stopPropagation()}
					onDoubleClick={(event) => event.stopPropagation()}
				/>
				<Button
					type="button"
					variant="ghost"
					size="icon-xs"
					title={`Save ${column.name}`}
					disabled={saving}
					onBlur={handleEditorBlur}
					onClick={(event) => {
						event.stopPropagation();
						void commit();
					}}
				>
					{saving ? (
						<Spinner className="h-3 w-3" />
					) : (
						<Check className="h-3 w-3" />
					)}
				</Button>
				<Button
					type="button"
					variant="ghost"
					size="icon-xs"
					title={`Reset ${column.name}`}
					disabled={saving}
					onBlur={handleEditorBlur}
					onClick={(event) => {
						event.stopPropagation();
						reset();
					}}
				>
					<ArrowCounterClockwise className="h-3 w-3" />
				</Button>
			</div>
		);
	}

	return (
		<div className="group/cell flex min-w-0 items-center">
			<div className="min-w-0 flex-1 truncate">{children}</div>
			{!disabled && (
				<Button
					type="button"
					variant="ghost"
					size="icon-xs"
					className="ml-1 opacity-0 group-hover/cell:opacity-100 focus-visible:opacity-100"
					title={`Edit ${column.name}`}
					onClick={(event) => {
						event.stopPropagation();
						setEditing(true);
					}}
				>
					<PencilSimple className="h-3 w-3" />
				</Button>
			)}
		</div>
	);
}
