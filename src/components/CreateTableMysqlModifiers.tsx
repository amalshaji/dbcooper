import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import type {
	CreateTableDbType,
	MysqlColumnModifiersDraft,
} from "@/lib/createTableForm";
import { getCreateTableModifierCapabilities } from "@/lib/databaseCatalog";

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

	return (
		<div className="flex flex-wrap items-end gap-3 rounded-md bg-muted/40 p-2.5">
			{capabilities.lengthTypes.includes(normalizedType) && (
				<div className="w-24 space-y-1.5">
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
			{capabilities.decimalTypes.includes(normalizedType) && (
				<>
					<div className="w-24 space-y-1.5">
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
					<div className="w-24 space-y-1.5">
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
			{capabilities.unsignedTypes.includes(normalizedType) && (
				<Label>
					<Switch
						size="sm"
						checked={modifiers.unsigned}
						onCheckedChange={(unsigned) => update({ unsigned })}
					/>
					Unsigned
				</Label>
			)}
			{capabilities.autoIncrementTypes.includes(normalizedType) && (
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
	);
}
