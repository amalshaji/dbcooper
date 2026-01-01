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
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Spinner } from "@/components/ui/spinner";
import { FloppyDisk, Key } from "@phosphor-icons/react";
import { toast } from "sonner";
import type { TableColumn } from "@/types/tabTypes";
import { FieldInput, type DbType } from "@/components/field-inputs";

interface RowInsertSheetProps {
	open: boolean;
	onOpenChange: (open: boolean) => void;
	tableName: string;
	columns: TableColumn[];
	dbType: DbType;
	onInsert: (
		values: Array<{
			column: string;
			value: unknown;
			isRawSql: boolean;
		}>,
	) => Promise<void>;
	inserting?: boolean;
}

interface FieldValue {
	value: unknown;
	isRawSql: boolean;
}

function isAutoIncrementColumn(column: TableColumn): boolean {
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

	return (
		column.type.toLowerCase().includes("serial") ||
		column.type.toLowerCase().includes("autoincrement") ||
		(column.primary_key && defaultIsFunction) ||
		(hasDefault && defaultIsFunction)
	);
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
	const [fieldValues, setFieldValues] = useState<Record<string, FieldValue>>(
		{},
	);

	useEffect(() => {
		if (open) {
			const initialValues: Record<string, FieldValue> = {};
			for (const col of columns) {
				if (
					col.type.toLowerCase().includes("int") ||
					col.type.toLowerCase().includes("serial")
				) {
					initialValues[col.name] = { value: null, isRawSql: false };
				} else {
					initialValues[col.name] = { value: "", isRawSql: false };
				}
			}
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

	const handleInsert = async () => {
		const values: Array<{
			column: string;
			value: unknown;
			isRawSql: boolean;
		}> = [];
		const missingRequired: string[] = [];

		for (const column of columns) {
			const fieldValue = fieldValues[column.name];
			const hasDefault =
				column.default &&
				column.default.toLowerCase() !== "null" &&
				column.default.trim() !== "";

			const isEmpty =
				!fieldValue ||
				fieldValue.value === null ||
				fieldValue.value === "" ||
				fieldValue.value === undefined ||
				(fieldValue.isRawSql &&
					(fieldValue.value === "NULL" || fieldValue.value === "null"));

			if (isAutoIncrementColumn(column) && isEmpty) {
				continue;
			}

			if (column.nullable && isEmpty) {
				continue;
			}

			if (!column.nullable && !hasDefault && isEmpty) {
				missingRequired.push(column.name);
				continue;
			}

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
					{columns.map((column) => (
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
							{isAutoIncrementColumn(column) ? (
								<div className="text-xs text-muted-foreground">
									Auto-generated
								</div>
							) : (
								<FieldInput
									column={column}
									value={fieldValues[column.name]?.value ?? null}
									isRawSql={fieldValues[column.name]?.isRawSql ?? false}
									dbType={dbType}
									onValueChange={handleValueChange}
								/>
							)}
						</div>
					))}
				</div>

				<SheetFooter className="flex-row gap-2 justify-end px-4">
					<Button variant="outline" onClick={() => onOpenChange(false)}>
						Cancel
					</Button>
					<Button onClick={handleInsert} disabled={inserting}>
						{inserting ? <Spinner /> : <FloppyDisk className="w-4 h-4" />}
						Insert Row
					</Button>
				</SheetFooter>
			</SheetContent>
		</Sheet>
	);
}
