import { useCallback } from "react";
import { useAIGeneration } from "@/hooks/useAIGeneration";
import { selectTablesForAI } from "@/lib/aiTableSelection";
import type { DatabaseTable } from "@/types/table";
import type { SchemaOverview, TableColumn } from "@/types/tabTypes";

interface UseContextualSqlGenerationOptions {
	dbType?: string;
	tables: DatabaseTable[];
	tableColumns: Record<string, TableColumn[]>;
	schemaOverview: SchemaOverview | null;
}

export function useContextualSqlGeneration({
	dbType,
	tables,
	tableColumns,
	schemaOverview,
}: UseContextualSqlGenerationOptions) {
	const { generateSQL, isConfigured } = useAIGeneration();

	const generateDraft = useCallback(
		async (
			instruction: string,
			existingSQL: string,
			onPreview: (sql: string) => void,
		): Promise<string> => {
			const overviewColumns = new Map(
				schemaOverview?.tables.map((table) => [
					`${table.schema}.${table.name}`,
					table.columns,
				]) ?? [],
			);
			const tableSchemas = tables.map((table) => {
				const fullName = `${table.schema}.${table.name}`;
				return {
					...table,
					columns:
						overviewColumns.get(fullName) ?? tableColumns[fullName] ?? [],
				};
			});
			const selectedTables = selectTablesForAI(
				instruction,
				existingSQL,
				tableSchemas,
			);

			let accumulatedSQL = "";
			let completedSQL = "";
			await generateSQL(
				dbType || "postgres",
				instruction,
				existingSQL,
				selectedTables.map((table) => ({
					schema: table.schema,
					name: table.name,
					columns: table.columns ?? [],
				})),
				(chunk) => {
					accumulatedSQL += chunk;
					onPreview(accumulatedSQL);
				},
				(finalSQL) => {
					completedSQL = finalSQL;
					onPreview(finalSQL);
				},
			);

			return completedSQL || accumulatedSQL;
		},
		[dbType, generateSQL, schemaOverview, tableColumns, tables],
	);

	return { generateDraft, isConfigured };
}
