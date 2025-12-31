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
import { Trash, FloppyDisk, Warning, Key, Code } from "@phosphor-icons/react";
import {
	Combobox,
	ComboboxInput,
	ComboboxContent,
	ComboboxList,
	ComboboxItem,
} from "@/components/ui/combobox";
import type { TableColumn } from "@/types/tabTypes";
import {
	getSuggestedFunctions,
	isSqlFunction,
} from "@/lib/sqlFunctions";

type DbType = "postgres" | "sqlite" | "clickhouse";

interface RowEditSheetProps {
    open: boolean;
    onOpenChange: (open: boolean) => void;
    tableName: string;
    row: Record<string, unknown> | null;
    columns: TableColumn[];
    dbType: DbType;
    onSave: (updates: Record<string, unknown>) => Promise<void>;
    onDelete: () => Promise<void>;
    saving?: boolean;
    deleting?: boolean;
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
}: RowEditSheetProps) {
    const [editedValues, setEditedValues] = useState<Record<string, FieldValue>>({});
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

    // Generate UUID v4 using Web Crypto API
    const generateUUIDv4 = (): string => {
        return crypto.randomUUID();
    };

    // Check if column is UUID-related
    const isUuidColumn = (column: TableColumn): boolean => {
        const columnNameLower = column.name.toLowerCase();
        const columnTypeLower = column.type.toLowerCase();
        return (
            columnNameLower.includes("uuid") ||
            columnTypeLower === "uuid" ||
            columnTypeLower.includes("uuid")
        );
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

    const renderFieldInput = (column: TableColumn) => {
        const fieldValue = editedValues[column.name] || {
            value: row?.[column.name] ?? null,
            isRawSql: false,
        };
        const value = fieldValue.value;
        const isRawSql = fieldValue.isRawSql;
        const isPrimaryKey = column.primary_key;
        const columnType = column.type.toLowerCase();

        // Determine if this should be readonly (primary keys are readonly)
        const isReadonly = isPrimaryKey || !hasPrimaryKey;

        // Get suggested functions for this column type and name
        const suggestedFunctions = getSuggestedFunctions(
            dbType,
            columnType,
            column.name,
        );

        // Handle null values
        const isNull = value === null;

        // Boolean types
        if (columnType === "boolean" || columnType === "bool") {
            return (
                <div className="flex items-center gap-2">
                    <Switch
                        checked={value === true || value === "TRUE" || value === "1"}
                        onCheckedChange={(checked) =>
                            handleValueChange(
                                column.name,
                                dbType === "sqlite" ? (checked ? "1" : "0") : checked,
                                false,
                            )
                        }
                        disabled={isReadonly}
                    />
                    <span className="text-sm text-muted-foreground">
                        {value === true || value === "TRUE" || value === "1"
                            ? "true"
                            : value === false || value === "FALSE" || value === "0"
                                ? "false"
                                : "null"}
                    </span>
                    {column.nullable && !isReadonly && (
                        <Button
                            variant="ghost"
                            size="sm"
                            className="h-6 text-xs"
                            onClick={() =>
                                handleValueChange(column.name, isNull ? false : null, false)
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
                                handleValueChange(column.name, parsed, false);
                            } catch {
                                // If not valid JSON, store as string (will show error on save)
                                handleValueChange(column.name, e.target.value, false);
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
                                handleValueChange(column.name, isNull ? {} : null, false)
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

            // Use Combobox if UUID functions are available
            if (suggestedFunctions.length > 0 && !isReadonly) {
                return (
                    <div className="space-y-1">
                        <Combobox
                            value={stringValue}
                            onValueChange={(newValue) => {
                                if (!newValue) return;
                                const isFunction =
                                    suggestedFunctions.includes(newValue) ||
                                    isSqlFunction(newValue);
                                handleValueChange(column.name, newValue, isFunction);
                            }}
                        >
                            <ComboboxInput
                                type="text"
                                value={stringValue}
                                onChange={(e) => {
                                    const newValue = e.target.value;
                                    const isFunction =
                                        suggestedFunctions.includes(newValue) ||
                                        isSqlFunction(newValue);
                                    handleValueChange(column.name, newValue, isFunction);
                                }}
                                disabled={isReadonly}
                                placeholder={isNull ? "NULL" : ""}
                                className="flex-1 !rounded-md"
                            />
                            <ComboboxContent className="!rounded-md">
                                <ComboboxList>
                                    {suggestedFunctions.map((func) => (
                                        <ComboboxItem key={func} value={func}>
                                            <Code className="w-4 h-4 mr-2" />
                                            {func}
                                        </ComboboxItem>
                                    ))}
                                </ComboboxList>
                            </ComboboxContent>
                        </Combobox>
                        {isRawSql && (
                            <Badge variant="secondary" className="text-xs">
                                SQL Function
                            </Badge>
                        )}
                        <div className="flex items-center gap-2">
                            {isUuidColumn(column) && !isReadonly && (
                                <Button
                                    variant="ghost"
                                    size="sm"
                                    className="h-6 text-xs"
                                    onClick={() =>
                                        handleValueChange(column.name, generateUUIDv4(), false)
                                    }
                                >
                                    Generate UUID
                                </Button>
                            )}
                            {column.nullable && !isReadonly && (
                                <Button
                                    variant="ghost"
                                    size="sm"
                                    className="h-6 text-xs"
                                    onClick={() =>
                                        handleValueChange(column.name, isNull ? "" : null, false)
                                    }
                                >
                                    {isNull ? "Set value" : "Set NULL"}
                                </Button>
                            )}
                        </div>
                    </div>
                );
            }

            return (
                <div className="space-y-1">
                    <Textarea
                        value={stringValue}
                        onChange={(e) => handleValueChange(column.name, e.target.value, false)}
                        disabled={isReadonly}
                        placeholder={isNull ? "NULL" : ""}
                        className="min-h-[60px]"
                    />
                    <div className="flex items-center gap-2">
                        {isUuidColumn(column) && !isReadonly && (
                            <Button
                                variant="ghost"
                                size="sm"
                                className="h-6 text-xs"
                                onClick={() =>
                                    handleValueChange(column.name, generateUUIDv4(), false)
                                }
                            >
                                Generate UUID
                            </Button>
                        )}
                        {column.nullable && !isReadonly && (
                            <Button
                                variant="ghost"
                                size="sm"
                                className="h-6 text-xs"
                                onClick={() => handleValueChange(column.name, isNull ? "" : null, false)}
                            >
                                {isNull ? "Set value" : "Set NULL"}
                            </Button>
                        )}
                    </div>
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
            const displayValue = isNull ? "" : String(value ?? "");

            // Use Combobox if functions are available
            if (suggestedFunctions.length > 0 && !isReadonly) {
                return (
                    <div className="space-y-1">
                        <Combobox
                            value={displayValue}
                            onValueChange={(newValue) => {
                                if (!newValue) return;
                                const isFunction = suggestedFunctions.includes(newValue);
                                if (isFunction) {
                                    handleValueChange(column.name, newValue, true);
                                } else if (newValue === "") {
                                    handleValueChange(column.name, null, false);
                                } else {
                                    const numValue =
                                        columnType.includes("int") || columnType.includes("serial")
                                            ? parseInt(newValue, 10)
                                            : parseFloat(newValue);
                                    handleValueChange(
                                        column.name,
                                        Number.isNaN(numValue) ? newValue : numValue,
                                        false,
                                    );
                                }
                            }}
                        >
                            <ComboboxInput
                                type="text"
                                value={displayValue}
                                onChange={(e) => {
                                    const newValue = e.target.value;
                                    if (newValue === "") {
                                        handleValueChange(column.name, null, false);
                                    } else {
                                        const isFunction =
                                            suggestedFunctions.includes(newValue) ||
                                            isSqlFunction(newValue);
                                        if (isFunction) {
                                            handleValueChange(column.name, newValue, true);
                                        } else {
                                            const numValue =
                                                columnType.includes("int") ||
                                                columnType.includes("serial")
                                                    ? parseInt(newValue, 10)
                                                    : parseFloat(newValue);
                                            handleValueChange(
                                                column.name,
                                                Number.isNaN(numValue) ? newValue : numValue,
                                                false,
                                            );
                                        }
                                    }
                                }}
                                disabled={isReadonly}
                                placeholder={isNull ? "NULL" : ""}
                                className="flex-1 !rounded-md"
                            />
                            <ComboboxContent className="!rounded-md">
                                <ComboboxList>
                                    {suggestedFunctions.map((func) => (
                                        <ComboboxItem key={func} value={func}>
                                            <Code className="w-4 h-4 mr-2" />
                                            {func}
                                        </ComboboxItem>
                                    ))}
                                </ComboboxList>
                            </ComboboxContent>
                        </Combobox>
                        {isRawSql && (
                            <Badge variant="secondary" className="text-xs">
                                SQL Function
                            </Badge>
                        )}
                        {column.nullable && !isReadonly && (
                            <Button
                                variant="ghost"
                                size="sm"
                                className="h-6 text-xs"
                                onClick={() =>
                                    handleValueChange(column.name, isNull ? 0 : null, false)
                                }
                            >
                                {isNull ? "Set 0" : "NULL"}
                            </Button>
                        )}
                    </div>
                );
            }

            return (
                <div className="flex items-center gap-2">
                    <Input
                        type="number"
                        value={displayValue}
                        onChange={(e) => {
                            const val = e.target.value;
                            if (val === "") {
                                handleValueChange(column.name, null, false);
                            } else if (columnType.includes("int") || columnType.includes("serial")) {
                                handleValueChange(column.name, parseInt(val, 10), false);
                            } else {
                                handleValueChange(column.name, parseFloat(val), false);
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
                                handleValueChange(column.name, isNull ? 0 : null, false)
                            }
                        >
                            {isNull ? "Set 0" : "NULL"}
                        </Button>
                    )}
                </div>
            );
        }

        // Timestamp/Date types
        if (
            columnType.includes("timestamp") ||
            columnType === "date" ||
            columnType === "time"
        ) {
            const displayValue = isNull ? "" : String(value ?? "");

            if (suggestedFunctions.length > 0 && !isReadonly) {
                return (
                    <div className="space-y-1">
                        <Combobox
                            value={displayValue}
                            onValueChange={(newValue) => {
                                if (!newValue) return;
                                const isFunction = suggestedFunctions.includes(newValue);
                                handleValueChange(column.name, newValue, isFunction);
                            }}
                        >
                            <ComboboxInput
                                type="text"
                                value={displayValue}
                                onChange={(e) => {
                                    const newValue = e.target.value;
                                    const isFunction =
                                        suggestedFunctions.includes(newValue) ||
                                        isSqlFunction(newValue);
                                    handleValueChange(column.name, newValue, isFunction);
                                }}
                                disabled={isReadonly}
                                placeholder={isNull ? "NULL" : "Enter date/time or select function"}
                                className="flex-1 !rounded-md"
                            />
                            <ComboboxContent className="!rounded-md">
                                <ComboboxList>
                                    {suggestedFunctions.map((func) => (
                                        <ComboboxItem key={func} value={func}>
                                            <Code className="w-4 h-4 mr-2" />
                                            {func}
                                        </ComboboxItem>
                                    ))}
                                </ComboboxList>
                            </ComboboxContent>
                        </Combobox>
                        {isRawSql && (
                            <Badge variant="secondary" className="text-xs">
                                SQL Function
                            </Badge>
                        )}
                        {column.nullable && !isReadonly && (
                            <Button
                                variant="ghost"
                                size="sm"
                                className="h-6 text-xs"
                                onClick={() =>
                                    handleValueChange(column.name, isNull ? "" : null, false)
                                }
                            >
                                {isNull ? "Set value" : "Set NULL"}
                            </Button>
                        )}
                    </div>
                );
            }

            return (
                <div className="space-y-1">
                    <Input
                        type="text"
                        value={displayValue}
                        onChange={(e) => handleValueChange(column.name, e.target.value, false)}
                        disabled={isReadonly}
                        placeholder={isNull ? "NULL" : "Enter date/time"}
                        className="flex-1"
                    />
                    {column.nullable && !isReadonly && (
                        <Button
                            variant="ghost"
                            size="sm"
                            className="h-6 text-xs"
                            onClick={() =>
                                handleValueChange(column.name, isNull ? "" : null, false)
                            }
                        >
                            {isNull ? "Set value" : "Set NULL"}
                        </Button>
                    )}
                </div>
            );
        }

        // UUID types
        if (columnType === "uuid" || isUuidColumn(column)) {
            const displayValue = isNull ? "" : String(value ?? "");

            if (suggestedFunctions.length > 0 && !isReadonly) {
                return (
                    <div className="space-y-1">
                        <Combobox
                            value={displayValue}
                            onValueChange={(newValue) => {
                                if (!newValue) return;
                                const isFunction = suggestedFunctions.includes(newValue);
                                handleValueChange(column.name, newValue, isFunction);
                            }}
                        >
                            <ComboboxInput
                                type="text"
                                value={displayValue}
                                onChange={(e) => {
                                    const newValue = e.target.value;
                                    const isFunction =
                                        suggestedFunctions.includes(newValue) ||
                                        isSqlFunction(newValue);
                                    handleValueChange(column.name, newValue, isFunction);
                                }}
                                disabled={isReadonly}
                                placeholder={isNull ? "NULL" : "Enter UUID or select function"}
                                className="flex-1 !rounded-md"
                            />
                            <ComboboxContent className="!rounded-md">
                                <ComboboxList>
                                    {suggestedFunctions.map((func) => (
                                        <ComboboxItem key={func} value={func}>
                                            <Code className="w-4 h-4 mr-2" />
                                            {func}
                                        </ComboboxItem>
                                    ))}
                                </ComboboxList>
                            </ComboboxContent>
                        </Combobox>
                        {isRawSql && (
                            <Badge variant="secondary" className="text-xs">
                                SQL Function
                            </Badge>
                        )}
                        <div className="flex items-center gap-2">
                            <Button
                                variant="ghost"
                                size="sm"
                                className="h-6 text-xs"
                                onClick={() =>
                                    handleValueChange(column.name, generateUUIDv4(), false)
                                }
                                disabled={isReadonly}
                            >
                                Generate UUID
                            </Button>
                            {column.nullable && !isReadonly && (
                                <Button
                                    variant="ghost"
                                    size="sm"
                                    className="h-6 text-xs"
                                    onClick={() =>
                                        handleValueChange(column.name, isNull ? "" : null, false)
                                    }
                                >
                                    {isNull ? "Set value" : "Set NULL"}
                                </Button>
                            )}
                        </div>
                    </div>
                );
            }

            return (
                <div className="space-y-1">
                    <Input
                        type="text"
                        value={displayValue}
                        onChange={(e) => handleValueChange(column.name, e.target.value, false)}
                        disabled={isReadonly}
                        placeholder={isNull ? "NULL" : "Enter UUID"}
                        className="flex-1"
                    />
                    <div className="flex items-center gap-2">
                        <Button
                            variant="ghost"
                            size="sm"
                            className="h-6 text-xs"
                            onClick={() =>
                                handleValueChange(column.name, generateUUIDv4(), false)
                            }
                            disabled={isReadonly}
                        >
                            Generate UUID
                        </Button>
                        {column.nullable && !isReadonly && (
                            <Button
                                variant="ghost"
                                size="sm"
                                className="h-6 text-xs"
                                onClick={() =>
                                    handleValueChange(column.name, isNull ? "" : null, false)
                                }
                            >
                                {isNull ? "Set value" : "Set NULL"}
                            </Button>
                        )}
                    </div>
                </div>
            );
        }

        // Default: text input with combobox for any suggested functions
        const stringValue = isNull
            ? ""
            : typeof value === "object"
                ? JSON.stringify(value)
                : String(value ?? "");

        if (suggestedFunctions.length > 0 && !isReadonly) {
            return (
                <div className="space-y-1">
                    <Combobox
                        value={stringValue}
                        onValueChange={(newValue) => {
                            if (!newValue) return;
                            const isFunction =
                                suggestedFunctions.includes(newValue) ||
                                isSqlFunction(newValue);
                            handleValueChange(column.name, newValue, isFunction);
                        }}
                    >
                        <ComboboxInput
                            type="text"
                            value={stringValue}
                            onChange={(e) => {
                                const newValue = e.target.value;
                                const isFunction =
                                    suggestedFunctions.includes(newValue) ||
                                    isSqlFunction(newValue);
                                handleValueChange(column.name, newValue, isFunction);
                            }}
                            disabled={isReadonly}
                            placeholder={isNull ? "NULL" : ""}
                            className="flex-1 !rounded-md"
                        />
                        <ComboboxContent className="!rounded-md">
                            <ComboboxList>
                                {suggestedFunctions.map((func) => (
                                    <ComboboxItem key={func} value={func}>
                                        <Code className="w-4 h-4 mr-2" />
                                        {func}
                                    </ComboboxItem>
                                ))}
                            </ComboboxList>
                        </ComboboxContent>
                    </Combobox>
                    {isRawSql && (
                        <Badge variant="secondary" className="text-xs">
                            SQL Function
                        </Badge>
                    )}
                    <div className="flex items-center gap-2">
                        {isUuidColumn(column) && !isReadonly && (
                            <Button
                                variant="ghost"
                                size="sm"
                                className="h-6 text-xs"
                                onClick={() =>
                                    handleValueChange(column.name, generateUUIDv4(), false)
                                }
                            >
                                Generate UUID
                            </Button>
                        )}
                        {column.nullable && !isReadonly && (
                            <Button
                                variant="ghost"
                                size="sm"
                                className="h-6 text-xs"
                                onClick={() =>
                                    handleValueChange(column.name, isNull ? "" : null, false)
                                }
                            >
                                {isNull ? "Set value" : "Set NULL"}
                            </Button>
                        )}
                    </div>
                </div>
            );
        }

        return (
            <div className="flex items-center gap-2">
                <Input
                    value={stringValue}
                    onChange={(e) => handleValueChange(column.name, e.target.value, false)}
                    disabled={isReadonly}
                    placeholder={isNull ? "NULL" : ""}
                    className="flex-1"
                />
                <div className="flex items-center gap-2">
                    {isUuidColumn(column) && !isReadonly && (
                        <Button
                            variant="ghost"
                            size="sm"
                            className="h-6 text-xs"
                            onClick={() =>
                                handleValueChange(column.name, generateUUIDv4(), false)
                            }
                        >
                            Generate UUID
                        </Button>
                    )}
                    {column.nullable && !isReadonly && (
                        <Button
                            variant="ghost"
                            size="sm"
                            className="h-8 text-xs"
                            onClick={() => handleValueChange(column.name, isNull ? "" : null, false)}
                        >
                            {isNull ? "Set value" : "NULL"}
                        </Button>
                    )}
                </div>
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
                                    <span className="font-medium">{column.name}</span>
                                    {column.primary_key && (
                                        <Badge variant="default" className="text-[10px] px-1 py-0 gap-0.5">
                                            <Key className="w-3 h-3" />
                                            PK
                                        </Badge>
                                    )}
                                    <span className="text-muted-foreground text-xs font-normal ml-auto">
                                        {column.type}
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
