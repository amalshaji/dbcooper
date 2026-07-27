import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import type {
	CreateTableDbType,
	MysqlColumnModifiersDraft,
} from "@/lib/createTableForm";
import { getCreateTableModifierCapabilities } from "../lib/databaseCatalog";

interface CreateTableMysqlModifiersProps {
	columnId: string;
	dbType: CreateTableDbType;
	dataType: string;
	modifiers: MysqlColumnModifiersDraft;
	onChange: (modifiers: MysqlColumnModifiersDraft) => void;
	onAutoIncrementChange: (autoIncrement: boolean) => void;
}

export function CreateTableMysqlModifiers({
	columnId,
	dbType,
	dataType,
	modifiers,
	onChange,
	onAutoIncrementChange,
}: CreateTableMysqlModifiersProps) {
	const capabilities = getCreateTableModifierCapabilities(dbType);
	const update = (updates: Partial<MysqlColumnModifiersDraft>) =>
		onChange({ ...modifiers, ...updates });
	const normalizedType = dataType.toUpperCase();
	const supportsLength = capabilities.lengthTypes.includes(normalizedType);
	const supportsDecimal = capabilities.decimalTypes.includes(normalizedType);
	const supportsUnsigned = capabilities.unsignedTypes.includes(normalizedType);
	const supportsAutoIncrement =
		capabilities.autoIncrementTypes.includes(normalizedType);

	if (
		!supportsLength &&
		!supportsDecimal &&
		!supportsUnsigned &&
		!supportsAutoIncrement
	) {
		return null;
	}

	return (
		<div className="grid gap-2 sm:grid-cols-[9rem_minmax(0,1fr)]">
			{supportsLength && (
				<div className="space-y-1.5">
					<Label htmlFor={`create-table-length-${columnId}`}>Length</Label>
					<Input
						id={`create-table-length-${columnId}`}
						type="number"
						min={1}
						value={modifiers.length}
						onChange={(event) => update({ length: event.target.value })}
					/>
				</div>
			)}
			{supportsDecimal && (
				<>
					<div className="space-y-1.5">
						<Label htmlFor={`create-table-precision-${columnId}`}>Precision</Label>
						<Input
							id={`create-table-precision-${columnId}`}
							type="number"
							min={1}
							max={65}
							value={modifiers.precision}
							onChange={(event) => update({ precision: event.target.value })}
						/>
					</div>
					<div className="space-y-1.5">
						<Label htmlFor={`create-table-scale-${columnId}`}>Scale</Label>
						<Input
							id={`create-table-scale-${columnId}`}
							type="number"
							min={0}
							max={30}
							value={modifiers.scale}
							onChange={(event) => update({ scale: event.target.value })}
						/>
					</div>
				</>
			)}
			{(supportsUnsigned || supportsAutoIncrement) && (
				<div className="flex flex-wrap items-center gap-x-5 gap-y-2 sm:col-span-2">
					{supportsUnsigned && (
						<Label>
							<Switch
								size="sm"
								checked={modifiers.unsigned}
								onCheckedChange={(unsigned) => update({ unsigned })}
							/>
							Unsigned
						</Label>
					)}
					{supportsAutoIncrement && (
						<Label>
							<Switch
								size="sm"
								checked={modifiers.autoIncrement}
								onCheckedChange={onAutoIncrementChange}
							/>
							Auto increment
						</Label>
					)}
				</div>
			)}
		</div>
	);
}
