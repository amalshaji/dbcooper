import type { TableDataResponse } from "./tableData";
import type { RedisKeyInfo, RedisKeyDetails } from "@/lib/tauri";

export type TabType = "table-data" | "table-structure" | "query" | "redis-query" | "schema-visualizer";

export interface TableColumn {
	name: string;
	type: string;
	nullable: boolean;
	default: string | null;
	primary_key: boolean;
}

export interface TableStructureData {
	columns: TableColumn[];
	indexes: {
		name: string;
		columns: string[];
		unique: boolean;
		primary: boolean;
	}[];
	foreign_keys: ForeignKeyInfo[];
}

export interface ForeignKeyInfo {
	name: string;
	column: string;
	references_table: string;
	references_column: string;
}

export interface IndexInfo {
	name: string;
	columns: string[];
	unique: boolean;
	primary: boolean;
}

interface BaseTab {
	id: string;
	type: TabType;
	title: string;
}

export interface TableDataTab extends BaseTab {
	type: "table-data";
	tableName: string;
	data: TableDataResponse | null;
	currentPage: number;
	loading: boolean;
	filterInput: string;
	filter: string;
	foreignKeys: ForeignKeyInfo[];
	columns: TableColumn[];
}

export interface TableStructureTab extends BaseTab {
	type: "table-structure";
	tableName: string;
	structure: TableStructureData | null;
	loading: boolean;
}

export interface QueryTab extends BaseTab {
	type: "query";
	query: string;
	savedQueryId: number | null;
	savedQueryName: string | null;
	results: Record<string, unknown>[] | null;
	error: string | null;
	success: boolean;
	executionTime: number | null;
	executing: boolean;
}

export interface RedisQueryTab extends BaseTab {
	type: "redis-query";
	pattern: string;
	keys: RedisKeyInfo[] | null;
	selectedKey: string | null;
	keyDetails: RedisKeyDetails | null;
	loadingKeys: boolean;
	loadingDetails: boolean;
}

export interface SchemaVisualizerTab extends BaseTab {
	type: "schema-visualizer";
	schemaOverview: SchemaOverview | null;
	loading: boolean;
	tableFilter: string;
	selectedTables: string[];
}

export interface SchemaOverview {
	tables: TableWithStructure[];
}

export interface TableWithStructure {
	schema: string;
	name: string;
	type: string;
	columns: TableColumn[];
	foreign_keys: ForeignKeyInfo[];
	indexes: IndexInfo[];
}

export type Tab = TableDataTab | TableStructureTab | QueryTab | RedisQueryTab | SchemaVisualizerTab;

export function createTableDataTab(tableName: string): TableDataTab {
	return {
		id: `table-data-${tableName}-${Date.now()}`,
		type: "table-data",
		title: tableName.split(".").pop() || tableName,
		tableName,
		data: null,
		currentPage: 1,
		loading: false,
		filterInput: "",
		filter: "",
		foreignKeys: [],
		columns: [],
	};
}

export function createTableStructureTab(tableName: string): TableStructureTab {
	return {
		id: `table-structure-${tableName}-${Date.now()}`,
		type: "table-structure",
		title: `${tableName.split(".").pop() || tableName} (structure)`,
		tableName,
		structure: null,
		loading: false,
	};
}

export function createQueryTab(
	query: string = "",
	savedQueryId: number | null = null,
	savedQueryName: string | null = null,
): QueryTab {
	return {
		id: `query-${Date.now()}`,
		type: "query",
		title: savedQueryName || "New Query",
		query,
		savedQueryId,
		savedQueryName,
		results: null,
		error: null,
		success: false,
		executionTime: null,
		executing: false,
	};
}

export function createRedisQueryTab(pattern: string = "*"): RedisQueryTab {
	return {
		id: `redis-query-${Date.now()}`,
		type: "redis-query",
		title: "Redis Keys",
		pattern,
		keys: null,
		selectedKey: null,
		keyDetails: null,
		loadingKeys: false,
		loadingDetails: false,
	};
}

export function createSchemaVisualizerTab(): SchemaVisualizerTab {
	return {
		id: `schema-visualizer-${Date.now()}`,
		type: "schema-visualizer",
		title: "Schema Visualizer",
		schemaOverview: null,
		loading: false,
		tableFilter: "",
		selectedTables: [],
	};
}
