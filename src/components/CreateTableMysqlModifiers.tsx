import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import type { CreateTableColumnDraft } from "@/lib/createTableForm";

interface CreateTableMysqlModifiersProps {
	column: CreateTableColumnDraft;
	onChange: (column: CreateTableColumnDraft) => void;
}

const LENGTH_TYPES = ["CHAR", "VARCHAR", "BINARY", "VARBINARY"];
const DECIMAL_TYPES = ["DECIMAL", "NUMERIC"];
const INTEGER_TYPES = [
	"TINYINT",
	"SMALLINT",
	"MEDIUMINT",
	"INT",
	"INTEGER",
	"BIGINT",
];
const UNSIGNED_TYPES = [
	...INTEGER_TYPES,
	...DECIMAL_TYPES,
	"FLOAT",
	"DOUBLE",
];

export function CreateTableMysqlModifiers({
	column,
	onChange,
}: CreateTableMysqlModifiersProps) {
	const dataType = column.dataType.toUpperCase();
	const update = (updates: Partial<CreateTableColumnDraft>) =>
		onChange({ ...column, ...updates });

	return (
		<div className="flex flex-wrap items-end gap-3 rounded-md bg-muted/40 p-2.5">
			{LENGTH_TYPES.includes(dataType) && (
				<div className="w-24 space-y-1.5">
					<Label htmlFor={`create-table-length-${column.id}`}>Length</Label>
					<Input
						id={`create-table-length-${column.id}`}
						type="number"
						min={1}
						value={column.length}
						onChange={(event) => update({ length: event.target.value })}
					/>
				</div>
			)}
			{DECIMAL_TYPES.includes(dataType) && (
				<>
					<div className="w-24 space-y-1.5">
						<Label htmlFor={`create-table-precision-${column.id}`}>Precision</Label>
						<Input
							id={`create-table-precision-${column.id}`}
							type="number"
							min={1}
							max={65}
							value={column.precision}
							onChange={(event) => update({ precision: event.target.value })}
						/>
					</div>
					<div className="w-24 space-y-1.5">
						<Label htmlFor={`create-table-scale-${column.id}`}>Scale</Label>
						<Input
							id={`create-table-scale-${column.id}`}
							type="number"
							min={0}
							max={30}
							value={column.scale}
							onChange={(event) => update({ scale: event.target.value })}
						/>
					</div>
				</>
			)}
			{UNSIGNED_TYPES.includes(dataType) && (
				<Label>
					<Switch
						size="sm"
						checked={column.unsigned}
						onCheckedChange={(unsigned) => update({ unsigned })}
					/>
					Unsigned
				</Label>
			)}
			{INTEGER_TYPES.includes(dataType) && (
				<Label>
					<Switch
						size="sm"
						checked={column.autoIncrement}
						onCheckedChange={(autoIncrement) =>
							update({
								autoIncrement,
								...(autoIncrement ? { primaryKey: true, nullable: false } : {}),
							})
						}
					/>
					Auto increment
				</Label>
			)}
		</div>
	);
}
