import type { TableDataResponse } from "./tableData";

export type TabType = "table-data" | "table-structure" | "query";

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

export type Tab = TableDataTab | TableStructureTab | QueryTab;

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
