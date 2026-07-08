import type { ColumnInfo } from "@/lib/tauri";
import type { DatabaseTable } from "@/types/table";

const AI_SCHEMA_TABLE_LIMIT = 8;

type AITableSchema = DatabaseTable & { columns?: ColumnInfo[] };

function getSearchTerms(input: string): Set<string> {
	const terms = input
		.toLowerCase()
		.split(/[^a-z0-9_]+/)
		.map((term) => term.trim())
		.filter((term) => term.length > 1);
	const expanded = new Set<string>();

	for (const term of terms) {
		expanded.add(term);
		if (term.endsWith("ies") && term.length > 4) {
			expanded.add(`${term.slice(0, -3)}y`);
		} else if (term.endsWith("es") && term.length > 3) {
			expanded.add(term.slice(0, -2));
		} else if (term.endsWith("s") && term.length > 3) {
			expanded.add(term.slice(0, -1));
		}
	}

	return expanded;
}

function scoreTableForAI(table: AITableSchema, terms: Set<string>): number {
	const schema = table.schema.toLowerCase();
	const name = table.name.toLowerCase();
	const fullName = `${schema}.${name}`;
	let score = 0;

	for (const term of terms) {
		if (fullName === term || name === term) score += 12;
		else if (name.includes(term) || term.includes(name)) score += 7;
		else if (schema.includes(term)) score += 2;

		for (const column of table.columns ?? []) {
			const columnName = column.name.toLowerCase();
			if (columnName === term) score += 4;
			else if (columnName.includes(term) || term.includes(columnName))
				score += 2;
		}
	}

	return score;
}

export function selectTablesForAI(
	instruction: string,
	existingSQL: string,
	tables: AITableSchema[],
): AITableSchema[] {
	if (tables.length <= AI_SCHEMA_TABLE_LIMIT) return tables;

	const terms = getSearchTerms(`${instruction}\n${existingSQL}`);
	return tables
		.map((table, index) => ({
			table,
			index,
			score: scoreTableForAI(table, terms),
		}))
		.sort((a, b) => b.score - a.score || a.index - b.index)
		.slice(0, AI_SCHEMA_TABLE_LIMIT)
		.map(({ table }) => table);
}
