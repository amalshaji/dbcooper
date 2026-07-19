import { Trash } from "@phosphor-icons/react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
	Select,
	SelectContent,
	SelectItem,
	SelectTrigger,
	SelectValue,
} from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { getCreateTableTypes } from "../lib/databaseCatalog";
import {
	type CreateTableColumnDraft,
	type CreateTableDbType,
	getDefaultExpressions,
} from "../lib/createTableForm";
import { CreateTableColumnDefault } from "./CreateTableColumnDefault";

interface CreateTableColumnRowProps {
	column: CreateTableColumnDraft;
	dbType: CreateTableDbType;
	canRemove: boolean;
	onChange: (column: CreateTableColumnDraft) => void;
	onRemove: () => void;
}

export function CreateTableColumnRow({
	column,
	dbType,
	canRemove,
	onChange,
	onRemove,
}: CreateTableColumnRowProps) {
	const inputId = `create-table-column-${column.id}`;

	const update = (updates: Partial<CreateTableColumnDraft>) => {
		onChange({ ...column, ...updates });
	};

	const handleTypeChange = (dataType: string | null) => {
		if (!dataType) return;
		const nextExpressions = getDefaultExpressions(dbType, dataType);
		const shouldClearExpression =
			column.default.kind === "expression" &&
			!nextExpressions.includes(column.default.value);
		update({
			dataType,
			...(shouldClearExpression ? { default: { kind: "none" as const } } : {}),
		});
	};

	return (
		<div className="space-y-3 rounded-lg border bg-card/60 p-3">
			<div className="grid grid-cols-[minmax(0,1fr)_minmax(8rem,0.8fr)_auto] gap-2">
				<div className="space-y-1.5">
					<Label htmlFor={`${inputId}-name`}>Column name</Label>
					<Input
						id={`${inputId}-name`}
						value={column.name}
						placeholder="column_name"
						autoComplete="off"
						onChange={(event) => update({ name: event.target.value })}
					/>
				</div>
				<div className="space-y-1.5">
					<Label htmlFor={`${inputId}-type`}>Type</Label>
					<Select value={column.dataType} onValueChange={handleTypeChange}>
						<SelectTrigger id={`${inputId}-type`} className="w-full">
							<SelectValue />
						</SelectTrigger>
						<SelectContent>
							{getCreateTableTypes(dbType).map((dataType) => (
								<SelectItem key={dataType} value={dataType}>
									{dataType}
								</SelectItem>
							))}
						</SelectContent>
					</Select>
				</div>
				<div className="flex items-end">
					<Button
						type="button"
						variant="ghost"
						size="icon"
						disabled={!canRemove}
						onClick={onRemove}
						aria-label={`Remove ${column.name || "column"}`}
					>
						<Trash />
					</Button>
				</div>
			</div>

			<CreateTableColumnDefault
				column={column}
				dbType={dbType}
				inputId={inputId}
				onChange={onChange}
			/>

			<fieldset className="flex flex-wrap items-center gap-x-5 gap-y-2">
				<legend className="sr-only">Column constraints</legend>
				<Label>
					<Switch
						size="sm"
						aria-label="Nullable"
						checked={column.nullable}
						disabled={column.primaryKey}
						onCheckedChange={(nullable) => update({ nullable })}
					/>
					Nullable
				</Label>
				<Label>
					<Switch
						size="sm"
						aria-label="Primary key"
						checked={column.primaryKey}
						onCheckedChange={(primaryKey) =>
							update({
								primaryKey,
								...(primaryKey ? { nullable: false } : {}),
							})
						}
					/>
					Primary key
				</Label>
				<Label>
					<Switch
						size="sm"
						aria-label="Unique"
						checked={column.unique}
						onCheckedChange={(unique) => update({ unique })}
					/>
					Unique
				</Label>
			</fieldset>
		</div>
	);
}
