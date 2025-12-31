import { useState, useEffect } from "react";
import {
	Sheet,
	SheetContent,
	SheetDescription,
	SheetHeader,
	SheetTitle,
	SheetFooter,
} from "@/components/ui/sheet";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Switch } from "@/components/ui/switch";
import { Badge } from "@/components/ui/badge";
import { Spinner } from "@/components/ui/spinner";
import {
	Combobox,
	ComboboxInput,
	ComboboxContent,
	ComboboxList,
	ComboboxItem,
} from "@/components/ui/combobox";
import { FloppyDisk, Key, Code } from "@phosphor-icons/react";
import { toast } from "sonner";
import type { TableColumn } from "@/types/tabTypes";
import {
	getSuggestedFunctions,
	isSqlFunction,
} from "@/lib/sqlFunctions";

type DbType = "postgres" | "sqlite" | "clickhouse";

interface RowInsertSheetProps {
	open: boolean;
	onOpenChange: (open: boolean) => void;
	tableName: string;
	columns: TableColumn[];
	dbType: DbType;
	onInsert: (values: Array<{
		column: string;
		value: unknown;
		isRawSql: boolean;
	}>) => Promise<void>;
	inserting?: boolean;
}

interface FieldValue {
	value: unknown;
	isRawSql: boolean;
}

export function RowInsertSheet({
	open,
	onOpenChange,
	tableName,
	columns,
	dbType,
	onInsert,
	inserting = false,
}: RowInsertSheetProps) {
	const [fieldValues, setFieldValues] = useState<
		Record<string, FieldValue>
	>({});

	// Reset values when sheet opens/closes
	useEffect(() => {
		if (open) {
			const initialValues: Record<string, FieldValue> = {};
			columns.forEach((col) => {
				// Initialize with null or empty string based on type
				if (
					col.type.toLowerCase().includes("int") ||
					col.type.toLowerCase().includes("serial")
				) {
					initialValues[col.name] = { value: null, isRawSql: false };
				} else {
					initialValues[col.name] = { value: "", isRawSql: false };
				}
			});
			setFieldValues(initialValues);
		} else {
			setFieldValues({});
		}
	}, [open, columns]);

	const handleValueChange = (
		columnName: string,
		value: unknown,
		isRawSql: boolean = false,
	) => {
		setFieldValues((prev) => ({
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

	const handleInsert = async () => {
		// Build values array, excluding empty/null values appropriately
		const values: Array<{
			column: string;
			value: unknown;
			isRawSql: boolean;
		}> = [];

		// Check for required fields that are missing
		const missingRequired: string[] = [];

		for (const column of columns) {
			const fieldValue = fieldValues[column.name];
			const hasDefault =
				column.default &&
				column.default.toLowerCase() !== "null" &&
				column.default.trim() !== "";
			const defaultLower = hasDefault ? column.default.toLowerCase() : "";
			const defaultIsFunction =
				hasDefault &&
				(defaultLower.includes("nextval") ||
					defaultLower.includes("gen_random_uuid") ||
					defaultLower.includes("uuid_generate") ||
					defaultLower.includes("generateuuid") ||
					defaultLower.includes("::regclass") ||
					defaultLower.includes("::text"));
			const isAutoIncrement =
				column.type.toLowerCase().includes("serial") ||
				column.type.toLowerCase().includes("autoincrement") ||
				(column.primary_key && defaultIsFunction) ||
				(hasDefault && defaultIsFunction);

			// Skip auto-increment columns if empty (let DB handle it)
			if (isAutoIncrement) {
				const isEmpty =
					!fieldValue ||
					fieldValue.value === null ||
					fieldValue.value === "" ||
					fieldValue.value === undefined ||
					(fieldValue.isRawSql &&
						(fieldValue.value === "NULL" || fieldValue.value === "null"));
				if (isEmpty) {
					continue; // Skip - let database use default
				}
			}

			// Skip nullable columns if empty
			if (
				column.nullable &&
				(!fieldValue ||
					fieldValue.value === null ||
					fieldValue.value === "" ||
					(fieldValue.isRawSql && fieldValue.value === "NULL"))
			) {
				continue;
			}

			// For non-nullable columns without defaults, require a value
			if (!column.nullable && !hasDefault) {
				if (
					!fieldValue ||
					fieldValue.value === null ||
					fieldValue.value === "" ||
					(fieldValue.isRawSql && fieldValue.value === "NULL")
				) {
					missingRequired.push(column.name);
					continue;
				}
			}

			// Include the value
			if (fieldValue) {
				values.push({
					column: column.name,
					value: fieldValue.value,
					isRawSql: fieldValue.isRawSql,
				});
			}
		}

		if (missingRequired.length > 0) {
			toast.error("Missing required fields", {
				description: `Please fill in: ${missingRequired.join(", ")}`,
			});
			return;
		}

		if (values.length === 0) {
			toast.error("No values to insert", {
				description: "Please fill in at least one field",
			});
			return;
		}

		await onInsert(values);
	};

	const renderFieldInput = (column: TableColumn) => {
		const fieldValue = fieldValues[column.name] || {
			value: null,
			isRawSql: false,
		};
		const value = fieldValue.value;
		const isRawSql = fieldValue.isRawSql;
		const columnType = column.type.toLowerCase();

		// Get suggested functions for this column type and name
		const suggestedFunctions = getSuggestedFunctions(
			dbType,
			columnType,
			column.name,
		);

		// Handle null values
		const isNull = value === null || value === "";

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
					/>
					<span className="text-sm text-muted-foreground">
						{value === true || value === "TRUE" || value === "1"
							? "true"
							: value === false || value === "FALSE" || value === "0"
								? "false"
								: "null"}
					</span>
					{column.nullable && (
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
		if (columnType.includes("json")) {
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
								handleValueChange(column.name, e.target.value, false);
							}
						}}
						placeholder={isNull ? "NULL" : ""}
						className="font-mono text-xs min-h-[80px]"
					/>
					{column.nullable && (
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

			// Use Combobox if UUID functions are available (e.g., column name contains "uuid")
			if (suggestedFunctions.length > 0) {
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
								placeholder={
									isNull
										? "NULL"
										: column.default
											? `Default: ${column.default}`
											: "Enter value or select function"
								}
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
							{isUuidColumn(column) && (
								<Button
									variant="ghost"
									size="sm"
									className="h-6 text-xs"
									onClick={() =>
										handleValueChange(
											column.name,
											generateUUIDv4(),
											false,
										)
									}
								>
									Generate UUID
								</Button>
							)}
							{column.nullable && (
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

			// Use Textarea for regular text fields without functions
			return (
				<div className="space-y-1">
					<Textarea
						value={stringValue}
						onChange={(e) =>
							handleValueChange(column.name, e.target.value, false)
						}
						placeholder={isNull ? "NULL" : ""}
						className="min-h-[60px]"
					/>
					<div className="flex items-center gap-2">
						{isUuidColumn(column) && (
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
						{column.nullable && (
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

		// Numeric types - use combobox for function suggestions
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
			const displayValue = isNull
				? ""
				: isRawSql
					? String(value)
					: String(value ?? "");

			// Use regular Input if no functions available
			if (suggestedFunctions.length === 0) {
				return (
					<div className="flex items-center gap-2">
						<Input
							type="number"
							value={displayValue}
							onChange={(e) => {
								const val = e.target.value;
								if (val === "") {
									handleValueChange(column.name, null, false);
								} else if (
									columnType.includes("int") ||
									columnType.includes("serial")
								) {
									handleValueChange(column.name, parseInt(val, 10), false);
								} else {
									handleValueChange(column.name, parseFloat(val), false);
								}
							}}
							placeholder={
								isNull
									? "NULL"
									: column.default
										? `Default: ${column.default}`
										: ""
							}
							className="flex-1"
						/>
						{column.nullable && (
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

			// Use Combobox when functions are available
			return (
				<div className="space-y-1">
					<Combobox
						value={displayValue}
						onValueChange={(newValue) => {
							if (!newValue) return;
							// Check if it's a function suggestion
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
							placeholder={
								isNull
									? "NULL"
									: column.default
										? `Default: ${column.default}`
										: ""
							}
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
					{column.nullable && (
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

		// Timestamp/Date types - use combobox for function suggestions
		if (
			columnType.includes("timestamp") ||
			columnType === "date" ||
			columnType === "time"
		) {
			const displayValue = isNull ? "" : String(value ?? "");

			// Use regular Input if no functions available
			if (suggestedFunctions.length === 0) {
				return (
					<div className="space-y-1">
						<Input
							type="text"
							value={displayValue}
							onChange={(e) =>
								handleValueChange(column.name, e.target.value, false)
							}
							placeholder={
								isNull
									? "NULL"
									: column.default
										? `Default: ${column.default}`
										: "Enter date/time"
							}
							className="flex-1"
						/>
						{column.nullable && (
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

			// Use Combobox when functions are available
			return (
				<div className="space-y-1">
					<Combobox
						value={displayValue}
						onValueChange={(newValue) => {
							if (!newValue) return;
							const isFunction = suggestedFunctions.includes(newValue);
							if (isFunction) {
								handleValueChange(column.name, newValue, true);
							} else {
								handleValueChange(column.name, newValue, false);
							}
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
							placeholder={
								isNull
									? "NULL"
									: column.default
										? `Default: ${column.default}`
										: "Enter date/time or select function"
							}
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
					{column.nullable && (
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

		// UUID types - use combobox for function suggestions
		if (columnType === "uuid") {
			const displayValue = isNull ? "" : String(value ?? "");

			// Use regular Input if no functions available (SQLite)
			if (suggestedFunctions.length === 0) {
				return (
					<div className="space-y-1">
						<Input
							type="text"
							value={displayValue}
							onChange={(e) =>
								handleValueChange(column.name, e.target.value, false)
							}
							placeholder={
								isNull
									? "NULL"
									: column.default
										? `Default: ${column.default}`
										: "Enter UUID"
							}
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
							>
								Generate UUID
							</Button>
							{column.nullable && (
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

			// Use Combobox when functions are available (PostgreSQL/ClickHouse)
			return (
				<div className="space-y-1">
					<Combobox
						value={displayValue}
						onValueChange={(newValue) => {
							if (!newValue) return;
							const isFunction = suggestedFunctions.includes(newValue);
							if (isFunction) {
								handleValueChange(column.name, newValue, true);
							} else {
								handleValueChange(column.name, newValue, false);
							}
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
							placeholder={
								isNull
									? "NULL"
									: column.default
										? `Default: ${column.default}`
										: "Enter UUID or select function"
							}
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
						>
							Generate UUID
						</Button>
						{column.nullable && (
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

		// Use regular Input if no functions available, Combobox if functions exist
		if (suggestedFunctions.length === 0) {
			return (
				<div className="space-y-1">
					<Input
						type="text"
						value={stringValue}
						onChange={(e) =>
							handleValueChange(column.name, e.target.value, false)
						}
						placeholder={
							isNull
								? "NULL"
								: column.default
									? `Default: ${column.default}`
									: ""
						}
						className="flex-1"
					/>
					<div className="flex items-center gap-2">
						{isUuidColumn(column) && (
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
						{column.nullable && (
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
						placeholder={
							isNull
								? "NULL"
								: column.default
									? `Default: ${column.default}`
									: ""
						}
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
					{isUuidColumn(column) && (
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
					{column.nullable && (
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
	};

	return (
		<Sheet open={open} onOpenChange={onOpenChange}>
			<SheetContent side="right" className="w-full sm:max-w-lg overflow-y-auto">
				<SheetHeader>
					<SheetTitle className="flex items-center gap-2">
						Insert Row
						<Badge variant="secondary" className="font-mono text-xs">
							{tableName}
						</Badge>
					</SheetTitle>
					<SheetDescription>
						Use SQL functions from dropdowns or enter literal values.
					</SheetDescription>
				</SheetHeader>

				<div className="py-6 px-4 space-y-4">
					{columns.map((column) => {
						const hasDefault =
							column.default &&
							column.default.toLowerCase() !== "null" &&
							column.default.trim() !== "";
						const defaultLower = hasDefault ? column.default.toLowerCase() : "";
						const defaultIsFunction =
							hasDefault &&
							(defaultLower.includes("nextval") ||
								defaultLower.includes("gen_random_uuid") ||
								defaultLower.includes("uuid_generate") ||
								defaultLower.includes("generateuuid") ||
								defaultLower.includes("::regclass") ||
								defaultLower.includes("::text"));
						const isAutoIncrement =
							column.type.toLowerCase().includes("serial") ||
							column.type.toLowerCase().includes("autoincrement") ||
							(column.primary_key && defaultIsFunction) ||
							(hasDefault && defaultIsFunction);

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
									{!column.nullable && (
										<Badge variant="outline" className="text-[10px] px-1 py-0">
											Required
										</Badge>
									)}
									<span className="text-muted-foreground text-xs font-normal ml-auto">
										{column.type}
									</span>
								</Label>
								{isAutoIncrement ? (
									<div className="text-xs text-muted-foreground">
										Auto-generated
									</div>
								) : (
									renderFieldInput(column)
								)}
							</div>
						);
					})}
				</div>

				<SheetFooter className="flex-row gap-2 justify-end px-4">
					<Button variant="outline" onClick={() => onOpenChange(false)}>
						Cancel
					</Button>
					<Button onClick={handleInsert} disabled={inserting}>
						{inserting ? (
							<>
								<Spinner />
								Inserting...
							</>
						) : (
							<>
								<FloppyDisk className="w-4 h-4" />
								Insert Row
							</>
						)}
					</Button>
				</SheetFooter>
			</SheetContent>
		</Sheet>
	);
}
