import { useState, useEffect, useMemo } from "react";
import {
	Sheet,
	SheetContent,
	SheetDescription,
	SheetHeader,
	SheetTitle,
	SheetFooter,
} from "@/components/ui/sheet";
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
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Spinner } from "@/components/ui/spinner";
import { Skeleton } from "@/components/ui/skeleton";
import { Trash, FloppyDisk, Warning, Key } from "@phosphor-icons/react";
import type { TableColumn } from "@/types/tabTypes";
import { FieldInput, type DbType } from "@/components/field-inputs";

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
	loading?: boolean;
}

interface FieldValue {
	value: unknown;
	isRawSql: boolean;
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
	loading = false,
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
			const initialValues: Record<string, FieldValue> = {};
			Object.entries(row).forEach(([key, value]) => {
				initialValues[key] = { value, isRawSql: false };
			});
			setEditedValues(initialValues);
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

	const handleDelete = async () => {
		setShowDeleteDialog(false);
		await onDelete();
	};

	const renderLoadingSkeleton = () => (
		<div className="py-6 px-4 space-y-4">
			{columns.slice(0, 8).map((column, idx) => (
				<div key={column.name || idx} className="space-y-1.5">
					<div className="flex items-center gap-2">
						<Skeleton className="h-4 w-24" />
						<Skeleton className="h-4 w-16 ml-auto" />
					</div>
					<Skeleton className="h-9 w-full" />
				</div>
			))}
			{columns.length > 8 && (
				<div className="text-xs text-muted-foreground text-center">
					Loading {columns.length - 8} more fields...
				</div>
			)}
		</div>
	);

	return (
		<>
			<Sheet open={open} onOpenChange={onOpenChange}>
				<SheetContent
					side="right"
					className="w-full sm:max-w-lg overflow-y-auto"
				>
					<SheetHeader>
						<SheetTitle className="flex items-center gap-2">
							{isClickHouse ? "View Row" : "Edit Row"}
							<Badge variant="secondary" className="font-mono">
								{tableName}
							</Badge>
						</SheetTitle>
						<SheetDescription>
							{loading ? (
								"Loading row data..."
							) : isClickHouse ? (
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

					{loading ? (
						renderLoadingSkeleton()
					) : row ? (
						<div className="py-6 px-4 space-y-4">
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
					) : null}

					{!isClickHouse && !loading && row && (
						<SheetFooter className="flex-row gap-2 justify-between sm:justify-between px-4">
							<Button
								variant="destructive"
								onClick={() => setShowDeleteDialog(true)}
								disabled={!hasPrimaryKey || deleting || saving}
							>
								{deleting ? <Spinner /> : <Trash className="w-4 h-4" />}
								Delete
							</Button>
							<Button
								onClick={handleSave}
								disabled={!hasPrimaryKey || !hasChanges || saving || deleting}
							>
								{saving ? <Spinner /> : <FloppyDisk className="w-4 h-4" />}
								Save Changes
							</Button>
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
