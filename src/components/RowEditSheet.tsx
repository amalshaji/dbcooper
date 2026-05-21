import {
	ArrowCounterClockwise,
	FloppyDisk,
	Key,
	Trash,
	Warning,
} from "@phosphor-icons/react";
import { useEffect, useMemo, useState } from "react";
import { type DbType, FieldInput } from "@/components/field-inputs";
import {
	AlertDialog,
	AlertDialogAction,
	AlertDialogCancel,
	AlertDialogContent,
	AlertDialogDescription,
	AlertDialogFooter,
	AlertDialogHeader,
	AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import {
	Sheet,
	SheetContent,
	SheetDescription,
	SheetFooter,
	SheetHeader,
	SheetTitle,
} from "@/components/ui/sheet";
import { Spinner } from "@/components/ui/spinner";
import type { TableColumn } from "@/types/tabTypes";

interface RowEditSheetProps {
	open: boolean;
	onOpenChange: (open: boolean) => void;
	tableName: string;
	row: Record<string, unknown> | null;
	columns: TableColumn[];
	dbType: DbType;
	onSave: (
		updates: Array<{ column: string; value: unknown; isRawSql: boolean }>,
	) => Promise<void>;
	onDelete: () => Promise<void>;
	saving?: boolean;
	deleting?: boolean;
}

interface FieldValue {
	value: unknown;
	isRawSql: boolean;
}

function getRowFieldValues(
	row: Record<string, unknown>,
): Record<string, FieldValue> {
	const initialValues: Record<string, FieldValue> = {};
	Object.entries(row).forEach(([key, value]) => {
		initialValues[key] = { value, isRawSql: false };
	});
	return initialValues;
}

export function RowEditSheet({
	open,
	onOpenChange,
	tableName,
	row,
	columns,
	dbType,
	onSave,
	onDelete,
	saving = false,
	deleting = false,
}: RowEditSheetProps) {
	const [editedValues, setEditedValues] = useState<Record<string, FieldValue>>(
		{},
	);
	const [showDeleteDialog, setShowDeleteDialog] = useState(false);

	// Get primary key columns
	const primaryKeyColumns = useMemo(
		() => columns.filter((col) => col.primary_key),
		[columns],
	);

	const hasPrimaryKey = primaryKeyColumns.length > 0;

	// ClickHouse doesn't support direct row updates through the edit sheet
	const isClickHouse = dbType === "clickhouse";

	// Reset edited values when row changes
	useEffect(() => {
		if (row) {
			setEditedValues(getRowFieldValues(row));
		} else {
			setEditedValues({});
		}
	}, [row]);

	// Check if there are any changes
	const hasChanges = useMemo(() => {
		if (!row) return false;
		return Object.keys(editedValues).some((key) => {
			// Skip primary key columns - they shouldn't be edited
			if (primaryKeyColumns.some((pk) => pk.name === key)) return false;
			// Compare values (handle null specially)
			const original = row[key];
			const fieldValue = editedValues[key];
			if (!fieldValue) return false;
			const edited = fieldValue.value;
			if (original === null && edited === null) return false;
			if (original === null || edited === null) return original !== edited;
			return JSON.stringify(original) !== JSON.stringify(edited);
		});
	}, [row, editedValues, primaryKeyColumns]);

	const handleValueChange = (
		columnName: string,
		value: unknown,
		isRawSql: boolean = false,
	) => {
		setEditedValues((prev) => ({
			...prev,
			[columnName]: { value, isRawSql },
		}));
	};

	const handleSave = async () => {
		if (!hasChanges) return;

		// Build updates array with raw SQL support (exclude primary key columns)
		const updates: Array<{
			column: string;
			value: unknown;
			isRawSql: boolean;
		}> = [];
		for (const [key, fieldValue] of Object.entries(editedValues)) {
			if (!primaryKeyColumns.some((pk) => pk.name === key)) {
				if (!fieldValue) continue;
				const original = row?.[key];
				const edited = fieldValue.value;
				// Only include changed values
				if (row && JSON.stringify(original) !== JSON.stringify(edited)) {
					updates.push({
						column: key,
						value: edited,
						isRawSql: fieldValue.isRawSql,
					});
				}
			}
		}

		await onSave(updates);
	};

	const handleReset = () => {
		if (!row) return;
		setEditedValues(getRowFieldValues(row));
	};

	const handleDelete = async () => {
		setShowDeleteDialog(false);
		await onDelete();
	};

	if (!row) return null;

	return (
		<>
			<Sheet open={open} onOpenChange={onOpenChange}>
				<SheetContent
					side="right"
					className="w-full sm:max-w-lg overflow-hidden"
				>
					<SheetHeader className="shrink-0">
						<SheetTitle className="flex items-center gap-2">
							{isClickHouse ? "View Row" : "Edit Row"}
							<Badge variant="secondary" className="font-mono">
								{tableName}
							</Badge>
						</SheetTitle>
						<SheetDescription>
							{isClickHouse ? (
								<span className="flex items-center gap-1 mt-2 text-amber-600">
									ClickHouse doesn't support direct row editing. Use ALTER TABLE
									UPDATE queries in the SQL editor instead.
								</span>
							) : hasPrimaryKey ? (
								<>
									Edit the values below and click Save to update the row.
									Primary key fields cannot be edited.
								</>
							) : (
								<span className="flex items-center gap-1 text-amber-600">
									<Warning className="w-4 h-4" />
									This table has no primary key. Row editing is disabled.
								</span>
							)}
						</SheetDescription>
					</SheetHeader>

					<div className="min-h-0 flex-1 overflow-y-auto px-4 py-6 space-y-4">
						{columns.map((column) => {
							const fieldValue = editedValues[column.name] || {
								value: row?.[column.name] ?? null,
								isRawSql: false,
							};
							const isPrimaryKey = column.primary_key;
							const isReadonly = isPrimaryKey || !hasPrimaryKey || isClickHouse;

							return (
								<div key={column.name} className="space-y-1.5">
									<Label className="flex items-center gap-2">
										<span className="font-medium">{column.name}</span>
										{column.primary_key && (
											<Badge
												variant="default"
												className="text-[10px] px-1 py-0 gap-0.5"
											>
												<Key className="w-3 h-3" />
												PK
											</Badge>
										)}
										<span className="text-muted-foreground text-xs font-normal ml-auto">
											{column.type}
										</span>
									</Label>
									<FieldInput
										column={column}
										value={fieldValue.value}
										isRawSql={fieldValue.isRawSql}
										dbType={dbType}
										onValueChange={handleValueChange}
										isReadonly={isReadonly}
									/>
								</div>
							);
						})}
					</div>

					{!isClickHouse && (
						<SheetFooter className="sticky bottom-0 z-10 shrink-0 flex-row gap-2 justify-between border-t bg-background/95 px-4 py-3 backdrop-blur supports-[backdrop-filter]:bg-background/80 sm:justify-between">
							<Button
								variant="destructive"
								onClick={() => setShowDeleteDialog(true)}
								disabled={!hasPrimaryKey || deleting || saving}
							>
								{deleting ? <Spinner /> : <Trash className="w-4 h-4" />}
								Delete
							</Button>
							<div className="flex items-center gap-2">
								<Button
									variant="outline"
									onClick={handleReset}
									disabled={!hasPrimaryKey || !hasChanges || saving || deleting}
								>
									<ArrowCounterClockwise className="w-4 h-4" />
									Reset
								</Button>
								<Button
									onClick={handleSave}
									disabled={!hasPrimaryKey || !hasChanges || saving || deleting}
								>
									{saving ? <Spinner /> : <FloppyDisk className="w-4 h-4" />}
									Save Changes
								</Button>
							</div>
						</SheetFooter>
					)}
				</SheetContent>
			</Sheet>

			<AlertDialog open={showDeleteDialog} onOpenChange={setShowDeleteDialog}>
				<AlertDialogContent>
					<AlertDialogHeader>
						<AlertDialogTitle>Delete this row?</AlertDialogTitle>
						<AlertDialogDescription>
							This action cannot be undone. The row will be permanently deleted
							from the database.
						</AlertDialogDescription>
					</AlertDialogHeader>
					<AlertDialogFooter>
						<AlertDialogCancel>Cancel</AlertDialogCancel>
						<AlertDialogAction onClick={handleDelete} variant="destructive">
							Delete
						</AlertDialogAction>
					</AlertDialogFooter>
				</AlertDialogContent>
			</AlertDialog>
		</>
	);
}
