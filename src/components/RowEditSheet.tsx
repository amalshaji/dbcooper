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
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Switch } from "@/components/ui/switch";
import { Badge } from "@/components/ui/badge";
import { Spinner } from "@/components/ui/spinner";
import { Trash, FloppyDisk, Warning, Key } from "@phosphor-icons/react";
import type { TableColumn } from "@/types/tabTypes";

interface RowEditSheetProps {
    open: boolean;
    onOpenChange: (open: boolean) => void;
    tableName: string;
    row: Record<string, unknown> | null;
    columns: TableColumn[];
    onSave: (updates: Record<string, unknown>) => Promise<void>;
    onDelete: () => Promise<void>;
    saving?: boolean;
    deleting?: boolean;
}

export function RowEditSheet({
    open,
    onOpenChange,
    tableName,
    row,
    columns,
    onSave,
    onDelete,
    saving = false,
    deleting = false,
}: RowEditSheetProps) {
    const [editedValues, setEditedValues] = useState<Record<string, unknown>>({});
    const [showDeleteDialog, setShowDeleteDialog] = useState(false);

    // Get primary key columns
    const primaryKeyColumns = useMemo(
        () => columns.filter((col) => col.primary_key),
        [columns]
    );

    const hasPrimaryKey = primaryKeyColumns.length > 0;

    // Reset edited values when row changes
    useEffect(() => {
        if (row) {
            setEditedValues({ ...row });
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
            const edited = editedValues[key];
            if (original === null && edited === null) return false;
            if (original === null || edited === null) return original !== edited;
            return JSON.stringify(original) !== JSON.stringify(edited);
        });
    }, [row, editedValues, primaryKeyColumns]);

    const handleValueChange = (columnName: string, value: unknown) => {
        setEditedValues((prev) => ({
            ...prev,
            [columnName]: value,
        }));
    };

    const handleSave = async () => {
        if (!hasChanges) return;

        // Build updates object (exclude primary key columns)
        const updates: Record<string, unknown> = {};
        for (const [key, value] of Object.entries(editedValues)) {
            if (!primaryKeyColumns.some((pk) => pk.name === key)) {
                // Only include changed values
                if (row && JSON.stringify(row[key]) !== JSON.stringify(value)) {
                    updates[key] = value;
                }
            }
        }

        await onSave(updates);
    };

    const handleDelete = async () => {
        setShowDeleteDialog(false);
        await onDelete();
    };

    const renderFieldInput = (column: TableColumn) => {
        const value = editedValues[column.name];
        const isPrimaryKey = column.primary_key;
        const columnType = column.type.toLowerCase();

        // Determine if this should be readonly (primary keys are readonly)
        const isReadonly = isPrimaryKey || !hasPrimaryKey;

        // Handle null values
        const isNull = value === null;

        // Boolean types
        if (columnType === "boolean" || columnType === "bool") {
            return (
                <div className="flex items-center gap-2">
                    <Switch
                        checked={value === true}
                        onCheckedChange={(checked) =>
                            handleValueChange(column.name, checked)
                        }
                        disabled={isReadonly}
                    />
                    <span className="text-sm text-muted-foreground">
                        {value === true ? "true" : value === false ? "false" : "null"}
                    </span>
                    {column.nullable && !isReadonly && (
                        <Button
                            variant="ghost"
                            size="sm"
                            className="h-6 text-xs"
                            onClick={() =>
                                handleValueChange(column.name, isNull ? false : null)
                            }
                        >
                            {isNull ? "Set value" : "Set NULL"}
                        </Button>
                    )}
                </div>
            );
        }

        // JSON/JSONB types
        if (
            columnType.includes("json") ||
            columnType === "jsonb"
        ) {
            const stringValue =
                typeof value === "object" && value !== null
                    ? JSON.stringify(value, null, 2)
                    : value === null
                        ? ""
                        : String(value);

            return (
                <div className="space-y-1">
                    <Textarea
                        value={isNull ? "" : stringValue}
                        onChange={(e) => {
                            try {
                                const parsed = JSON.parse(e.target.value);
                                handleValueChange(column.name, parsed);
                            } catch {
                                // If not valid JSON, store as string (will show error on save)
                                handleValueChange(column.name, e.target.value);
                            }
                        }}
                        disabled={isReadonly}
                        placeholder={isNull ? "NULL" : ""}
                        className="font-mono text-xs min-h-[80px]"
                    />
                    {column.nullable && !isReadonly && (
                        <Button
                            variant="ghost"
                            size="sm"
                            className="h-6 text-xs"
                            onClick={() =>
                                handleValueChange(column.name, isNull ? {} : null)
                            }
                        >
                            {isNull ? "Set value" : "Set NULL"}
                        </Button>
                    )}
                </div>
            );
        }

        // Text/long string types
        if (columnType === "text" || columnType.includes("varchar")) {
            const stringValue = isNull ? "" : String(value ?? "");

            return (
                <div className="space-y-1">
                    <Textarea
                        value={stringValue}
                        onChange={(e) => handleValueChange(column.name, e.target.value)}
                        disabled={isReadonly}
                        placeholder={isNull ? "NULL" : ""}
                        className="min-h-[60px]"
                    />
                    {column.nullable && !isReadonly && (
                        <Button
                            variant="ghost"
                            size="sm"
                            className="h-6 text-xs"
                            onClick={() => handleValueChange(column.name, isNull ? "" : null)}
                        >
                            {isNull ? "Set value" : "Set NULL"}
                        </Button>
                    )}
                </div>
            );
        }

        // Numeric types
        if (
            columnType.includes("int") ||
            columnType.includes("numeric") ||
            columnType.includes("decimal") ||
            columnType.includes("real") ||
            columnType.includes("double") ||
            columnType.includes("float") ||
            columnType === "serial" ||
            columnType === "bigserial"
        ) {
            return (
                <div className="flex items-center gap-2">
                    <Input
                        type="number"
                        value={isNull ? "" : String(value ?? "")}
                        onChange={(e) => {
                            const val = e.target.value;
                            if (val === "") {
                                handleValueChange(column.name, null);
                            } else if (columnType.includes("int") || columnType.includes("serial")) {
                                handleValueChange(column.name, parseInt(val, 10));
                            } else {
                                handleValueChange(column.name, parseFloat(val));
                            }
                        }}
                        disabled={isReadonly}
                        placeholder={isNull ? "NULL" : ""}
                        className="flex-1"
                    />
                    {column.nullable && !isReadonly && (
                        <Button
                            variant="ghost"
                            size="sm"
                            className="h-8 text-xs"
                            onClick={() =>
                                handleValueChange(column.name, isNull ? 0 : null)
                            }
                        >
                            {isNull ? "Set 0" : "NULL"}
                        </Button>
                    )}
                </div>
            );
        }

        // Default: text input
        const stringValue = isNull
            ? ""
            : typeof value === "object"
                ? JSON.stringify(value)
                : String(value ?? "");

        return (
            <div className="flex items-center gap-2">
                <Input
                    value={stringValue}
                    onChange={(e) => handleValueChange(column.name, e.target.value)}
                    disabled={isReadonly}
                    placeholder={isNull ? "NULL" : ""}
                    className="flex-1"
                />
                {column.nullable && !isReadonly && (
                    <Button
                        variant="ghost"
                        size="sm"
                        className="h-8 text-xs"
                        onClick={() => handleValueChange(column.name, isNull ? "" : null)}
                    >
                        {isNull ? "Set value" : "NULL"}
                    </Button>
                )}
            </div>
        );
    };

    if (!row) return null;

    return (
        <>
            <Sheet open={open} onOpenChange={onOpenChange}>
                <SheetContent side="right" className="w-full sm:max-w-lg overflow-y-auto">
                    <SheetHeader>
                        <SheetTitle className="flex items-center gap-2">
                            Edit Row
                            <Badge variant="secondary" className="font-mono">
                                {tableName}
                            </Badge>
                        </SheetTitle>
                        <SheetDescription>
                            {hasPrimaryKey ? (
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

                    <div className="py-6 px-4 space-y-4">
                        {columns.map((column) => (
                            <div key={column.name} className="space-y-1.5">
                                <Label className="flex items-center gap-2">
                                    {column.name}
                                    {column.primary_key && (
                                        <Badge variant="default" className="text-[10px] px-1 py-0 gap-0.5">
                                            <Key className="w-3 h-3" />
                                            PK
                                        </Badge>
                                    )}
                                    <span className="text-muted-foreground text-xs font-normal">
                                        {column.type}
                                        {column.nullable && " (nullable)"}
                                    </span>
                                </Label>
                                {renderFieldInput(column)}
                            </div>
                        ))}
                    </div>

                    <SheetFooter className="flex-row gap-2 justify-between sm:justify-between px-4">
                        <Button
                            variant="destructive"
                            onClick={() => setShowDeleteDialog(true)}
                            disabled={!hasPrimaryKey || deleting || saving}
                        >
                            {deleting ? (
                                <Spinner />
                            ) : (
                                <Trash className="w-4 h-4" />
                            )}
                            Delete
                        </Button>
                        <Button
                            onClick={handleSave}
                            disabled={!hasPrimaryKey || !hasChanges || saving || deleting}
                        >
                            {saving ? (
                                <Spinner />
                            ) : (
                                <FloppyDisk className="w-4 h-4" />
                            )}
                            Save Changes
                        </Button>
                    </SheetFooter>
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
                        <AlertDialogAction
                            onClick={handleDelete}
                            className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
                        >
                            Delete
                        </AlertDialogAction>
                    </AlertDialogFooter>
                </AlertDialogContent>
            </AlertDialog>
        </>
    );
}
