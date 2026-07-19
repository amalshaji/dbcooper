import { useState } from "react";
import { Plus } from "@phosphor-icons/react";
import { Button } from "@/components/ui/button";
import {
	getDefaultSchema,
	type CreateTableDbType,
} from "@/lib/databaseCatalog";
import type { CreateTableRequest, TableInfo } from "@/lib/tauri";
import { CreateTableSheet } from "../CreateTableSheet";

export interface ObjectExplorerCreateTableCapability {
	dbType: CreateTableDbType;
	onPreview: (request: CreateTableRequest) => Promise<string>;
	onCreate: (request: CreateTableRequest) => Promise<TableInfo>;
	onCreated: (table: TableInfo) => void;
}

interface ObjectExplorerCreateTableProps {
	capability: ObjectExplorerCreateTableCapability;
	schemas: string[];
	selectedSchema?: string;
}

export function ObjectExplorerCreateTable({
	capability,
	schemas,
	selectedSchema,
}: ObjectExplorerCreateTableProps) {
	const [open, setOpen] = useState(false);
	const defaultSchema = getDefaultSchema(capability.dbType);
	const availableSchemas =
		capability.dbType === "sqlite"
			? [defaultSchema]
			: Array.from(new Set([defaultSchema, ...schemas])).sort((left, right) =>
					left.localeCompare(right),
				);

	return (
		<>
			<Button
				type="button"
				variant="outline"
				size="sm"
				className="w-full justify-start"
				onClick={() => setOpen(true)}
			>
				<Plus />
				Create table
			</Button>
			{open && (
				<CreateTableSheet
					dbType={capability.dbType}
					initialSchema={
						capability.dbType === "sqlite"
							? defaultSchema
							: selectedSchema || defaultSchema
					}
					availableSchemas={availableSchemas}
					onClose={() => setOpen(false)}
					onPreview={capability.onPreview}
					onCreate={capability.onCreate}
					onCreated={capability.onCreated}
				/>
			)}
		</>
	);
}
