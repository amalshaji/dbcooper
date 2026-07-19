import { Plus } from "@phosphor-icons/react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
	createEmptyTableColumn,
	type CreateTableDbType,
	type CreateTableDraft,
} from "../lib/createTableForm";
import { CreateTableColumnRow } from "./CreateTableColumnRow";

interface CreateTableDefinitionProps {
	draft: CreateTableDraft;
	dbType: CreateTableDbType;
	availableSchemas: string[];
	onChange: (draft: CreateTableDraft) => void;
}

export function CreateTableDefinition({
	draft,
	dbType,
	availableSchemas,
	onChange,
}: CreateTableDefinitionProps) {
	const update = (updates: Partial<CreateTableDraft>) => {
		onChange({ ...draft, ...updates });
	};

	return (
		<>
			<div className="grid gap-3 sm:grid-cols-2">
				<div className="space-y-1.5">
					<Label htmlFor="create-table-schema">Schema</Label>
					<Input
						id="create-table-schema"
						value={draft.schema}
						disabled={dbType === "sqlite"}
						list={
							dbType === "postgres"
								? "create-table-schema-options"
								: undefined
						}
						onChange={(event) => update({ schema: event.target.value })}
					/>
					{dbType === "postgres" && (
						<datalist id="create-table-schema-options">
							{availableSchemas.map((schema) => (
								<option key={schema} value={schema} />
							))}
						</datalist>
					)}
				</div>
				<div className="space-y-1.5">
					<Label htmlFor="create-table-name">Table name</Label>
					<Input
						id="create-table-name"
						value={draft.tableName}
						placeholder="table_name"
						autoComplete="off"
						onChange={(event) => update({ tableName: event.target.value })}
					/>
				</div>
			</div>

			<div className="space-y-3">
				<div className="flex items-center justify-between">
					<div>
						<h3 className="text-sm font-medium">Columns</h3>
						<p className="text-xs text-muted-foreground">
							Primary-key columns are always non-nullable.
						</p>
					</div>
					<Button
						type="button"
						variant="outline"
						size="sm"
						onClick={() =>
							update({
								columns: [...draft.columns, createEmptyTableColumn()],
							})
						}
					>
						<Plus />
						Add column
					</Button>
				</div>
				{draft.columns.map((column) => (
					<CreateTableColumnRow
						key={column.id}
						column={column}
						dbType={dbType}
						canRemove={draft.columns.length > 1}
						onChange={(nextColumn) =>
							update({
								columns: draft.columns.map((item) =>
									item.id === column.id ? nextColumn : item,
								),
							})
						}
						onRemove={() =>
							update({
								columns: draft.columns.filter(
									(item) => item.id !== column.id,
								),
							})
						}
					/>
				))}
			</div>
		</>
	);
}
