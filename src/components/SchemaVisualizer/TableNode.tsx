import { memo, useMemo } from "react";
import { Handle, Position, type NodeProps } from "@xyflow/react";
import { Badge } from "@/components/ui/badge";
import type { TableColumn, ForeignKeyInfo } from "@/types/tabTypes";

interface TableNodeData {
	tableName: string;
	schema: string;
	columns: TableColumn[];
	foreignKeys: ForeignKeyInfo[];
	referencedColumns: Set<string>;
	showColumns: boolean;
	onTableClick?: (tableName: string) => void;
}

const HEADER_HEIGHT = 36;
const ROW_HEIGHT = 36;

export const TableNode = memo(({ data }: NodeProps<TableNodeData>) => {
	const { tableName, schema, columns, foreignKeys, referencedColumns, showColumns, onTableClick } = data;
	const fullTableName = `${schema}.${tableName}`;

	const handles = useMemo(() => {
		if (!showColumns) return null;
		
		const sourceHandles: { id: string; top: number }[] = [];
		const targetHandles: { id: string; top: number }[] = [];
		
		columns.forEach((column, index) => {
			const top = HEADER_HEIGHT + (index * ROW_HEIGHT) + (ROW_HEIGHT / 2);
			
			const fk = foreignKeys.find((fk) => fk.column === column.name);
			if (fk) {
				sourceHandles.push({ id: `${column.name}-source`, top });
			}
			
			if (column.primary_key || referencedColumns.has(column.name)) {
				targetHandles.push({ id: `${column.name}-target`, top });
			}
		});
		
		return { sourceHandles, targetHandles };
	}, [columns, foreignKeys, referencedColumns, showColumns]);

	return (
		<div className="bg-card border-2 border-border rounded-lg shadow-lg min-w-[200px] max-w-[300px]">
			<div
				className="bg-primary text-primary-foreground px-3 rounded-t-md font-semibold text-sm cursor-pointer hover:bg-primary/90 transition-colors flex items-center"
				style={{ height: HEADER_HEIGHT }}
				onClick={() => onTableClick?.(fullTableName)}
			>
				{tableName}
			</div>
			{showColumns && (
				<div className="divide-y divide-border">
					{columns.map((column, index) => {
						const fk = foreignKeys.find((fk) => fk.column === column.name);
						return (
							<div
								key={index}
								className="px-3 text-xs hover:bg-muted/50 transition-colors flex items-center justify-between"
								style={{ height: ROW_HEIGHT }}
							>
								<span className="font-mono truncate mr-2">{column.name}</span>
								<div className="flex items-center gap-1 shrink-0">
									{column.primary_key && (
										<Badge variant="outline" className="text-[10px] px-1 py-0 bg-blue-500/10 text-blue-600 dark:text-blue-400 border-blue-500/20">
											PK
										</Badge>
									)}
									{fk && (
										<Badge variant="outline" className="text-[10px] px-1 py-0 bg-orange-500/10 text-orange-600 dark:text-orange-400 border-orange-500/20">
											FK
										</Badge>
									)}
									{column.nullable && (
										<span className="text-muted-foreground text-[10px]">?</span>
									)}
								</div>
							</div>
						);
					})}
				</div>
			)}
			
			{showColumns && handles && (
				<>
					{handles.sourceHandles.map((handle) => (
						<Handle
							key={handle.id}
							type="source"
							position={Position.Right}
							id={handle.id}
							style={{
								top: handle.top,
								width: 8,
								height: 8,
								background: "#f97316",
								border: "none",
							}}
						/>
					))}
					{handles.targetHandles.map((handle) => (
						<Handle
							key={handle.id}
							type="target"
							position={Position.Left}
							id={handle.id}
							style={{
								top: handle.top,
								width: 8,
								height: 8,
								background: "#f97316",
								border: "none",
							}}
						/>
					))}
				</>
			)}
			
			{!showColumns && (
				<>
					<Handle
						type="target"
						position={Position.Left}
						style={{
							width: 8,
							height: 8,
							background: "#f97316",
							border: "none",
						}}
					/>
					<Handle
						type="source"
						position={Position.Right}
						style={{
							width: 8,
							height: 8,
							background: "#f97316",
							border: "none",
						}}
					/>
				</>
			)}
		</div>
	);
});

TableNode.displayName = "TableNode";
