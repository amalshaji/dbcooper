import { type Dispatch, type SetStateAction, useCallback } from "react";
import { createCellFilter } from "@/lib/resultFilters";
import { normalizeColumnLayout } from "@/lib/savedViews";
import { api } from "@/lib/tauri";
import type { DispatchTabPatch } from "@/lib/connection-details/tabState";
import { useNativeCloseListener } from "./useNativeCloseListener";
import {
	createFunctionDefinitionTab,
	createQueryTab,
	createSchemaVisualizerTab,
	createTableDataTab,
	createTableStructureTab,
	type FunctionDefinitionTab,
	type FunctionSummary,
	formatFunctionSignature,
	type SchemaOverview,
	type Tab,
	type TableColumn,
	type TableDataTab,
	type TableStructureTab,
} from "@/types/tabTypes";

export interface UseConnectionTabActionsOptions {
	uuid: string | undefined;
	tabs: Tab[];
	setTabs: Dispatch<SetStateAction<Tab[]>>;
	activeTabId: string | null;
	setActiveTabId: Dispatch<SetStateAction<string | null>>;
	schemaOverview: SchemaOverview | null;
	patchTab: DispatchTabPatch;
	fetchTableData: (tab: TableDataTab) => Promise<void>;
	cancelTabGeneration: (tabId: string) => void;
}

export function useConnectionTabActions({
	uuid,
	tabs,
	setTabs,
	activeTabId,
	setActiveTabId,
	schemaOverview,
	patchTab,
	fetchTableData,
	cancelTabGeneration,
}: UseConnectionTabActionsOptions) {
	const fetchTableStructure = useCallback(
		async (tab: TableStructureTab) => {
			if (!uuid) return;

			patchTab({
				type: "table-structure",
				tabId: tab.id,
				changes: { loading: true },
			});

			try {
				const [schema, tableName] = tab.tableName.split(".");
				const fullTableName = `${schema}.${tableName}`;

				if (schemaOverview) {
					const tableData = schemaOverview.tables.find(
						(table) => `${table.schema}.${table.name}` === fullTableName,
					);

					if (tableData) {
						patchTab({
							type: "table-structure",
							tabId: tab.id,
							changes: {
								structure: {
									columns: tableData.columns,
									indexes: tableData.indexes,
									foreign_keys: tableData.foreign_keys,
								},
								loading: false,
							},
						});
						return;
					}
				}

				const data = await api.pool.getTableStructure(uuid, schema, tableName);

				patchTab({
					type: "table-structure",
					tabId: tab.id,
					changes: { structure: data, loading: false },
				});
			} catch (error) {
				console.error("Failed to fetch table structure:", error);
				patchTab({
					type: "table-structure",
					tabId: tab.id,
					changes: { structure: null, loading: false },
				});
			}
		},
		[uuid, patchTab, schemaOverview],
	);

	const fetchFunctionDefinition = useCallback(
		async (tab: FunctionDefinitionTab) => {
			if (!uuid) return;

			patchTab({
				type: "function-definition",
				tabId: tab.id,
				changes: { loading: true, error: null },
			});

			try {
				const definition = await api.pool.getFunctionDefinition(
					uuid,
					tab.functionSummary.schema,
					tab.functionSummary.name,
					tab.functionSummary.identity_args,
				);

				patchTab({
					type: "function-definition",
					tabId: tab.id,
					changes: { definition, loading: false, error: null },
				});
			} catch (error) {
				console.error("Failed to fetch function definition:", error);
				const errorMessage =
					error instanceof Error ? error.message : String(error);
				patchTab({
					type: "function-definition",
					tabId: tab.id,
					changes: { definition: null, loading: false, error: errorMessage },
				});
			}
		},
		[uuid, patchTab],
	);

	const fetchForeignKeys = useCallback(
		async (tab: TableDataTab) => {
			if (!uuid) return;

			try {
				const [schema, tableName] = tab.tableName.split(".");
				const fullTableName = `${schema}.${tableName}`;

				if (schemaOverview) {
					const tableData = schemaOverview.tables.find(
						(table) => `${table.schema}.${table.name}` === fullTableName,
					);

					if (tableData) {
						const columns = tableData.columns || [];
						patchTab({
							type: "table-data",
							tabId: tab.id,
							changes: {
								foreignKeys: tableData.foreign_keys || [],
								columns,
								columnLayout: normalizeColumnLayout(
									tab.columnLayout,
									columns.map((column) => column.name),
								),
							},
						});
						return;
					}
				}

				const data = await api.pool.getTableStructure(uuid, schema, tableName);
				const columns: TableColumn[] = data.columns || [];
				patchTab({
					type: "table-data",
					tabId: tab.id,
					changes: {
						foreignKeys: data.foreign_keys || [],
						columns,
						columnLayout: normalizeColumnLayout(
							tab.columnLayout,
							columns.map((column) => column.name),
						),
					},
				});
			} catch (error) {
				console.error("Failed to fetch foreign keys:", error);
			}
		},
		[uuid, patchTab, schemaOverview],
	);

	const handleOpenTableData = useCallback(
		(tableName: string) => {
			const existingTab = tabs.find(
				(tab) => tab.type === "table-data" && tab.tableName === tableName,
			);

			if (existingTab) {
				setActiveTabId(existingTab.id);
				return;
			}

			const newTab = createTableDataTab(tableName);
			setTabs((previous) => [...previous, newTab]);
			setActiveTabId(newTab.id);

			void fetchTableData(newTab);
			void fetchForeignKeys(newTab);
		},
		[tabs, setTabs, setActiveTabId, fetchTableData, fetchForeignKeys],
	);

	const handleOpenTableDataWithFilter = useCallback(
		(tableName: string, filterColumn: string, filterValue: unknown) => {
			const newTab = createTableDataTab(tableName);
			const condition = createCellFilter(filterColumn, filterValue, false);
			const filter = {
				kind: "structured" as const,
				value: { conjunction: "and" as const, conditions: [condition] },
			};
			newTab.filterState = { draft: filter, applied: filter };

			setTabs((previous) => [...previous, newTab]);
			setActiveTabId(newTab.id);

			void fetchTableData(newTab);
			void fetchForeignKeys(newTab);
		},
		[setTabs, setActiveTabId, fetchTableData, fetchForeignKeys],
	);

	const handleOpenTableStructure = useCallback(
		(tableName: string) => {
			const existingTab = tabs.find(
				(tab) => tab.type === "table-structure" && tab.tableName === tableName,
			);

			if (existingTab) {
				setActiveTabId(existingTab.id);
				return;
			}

			const newTab = createTableStructureTab(tableName);
			setTabs((previous) => [...previous, newTab]);
			setActiveTabId(newTab.id);

			void fetchTableStructure(newTab);
		},
		[tabs, setTabs, setActiveTabId, fetchTableStructure],
	);

	const handleOpenFunctionDefinition = useCallback(
		(functionSummary: FunctionSummary) => {
			const existingTab = tabs.find(
				(tab) =>
					tab.type === "function-definition" &&
					formatFunctionSignature(tab.functionSummary) ===
						formatFunctionSignature(functionSummary),
			);

			if (existingTab) {
				setActiveTabId(existingTab.id);
				return;
			}

			const newTab = createFunctionDefinitionTab(functionSummary);
			setTabs((previous) => [...previous, newTab]);
			setActiveTabId(newTab.id);
			void fetchFunctionDefinition(newTab);
		},
		[tabs, setTabs, setActiveTabId, fetchFunctionDefinition],
	);

	const handleOpenQuery = useCallback(
		(
			query: string,
			savedQueryId: number | null = null,
			savedQueryName: string | null = null,
		) => {
			if (savedQueryId) {
				const existingTab = tabs.find(
					(tab) => tab.type === "query" && tab.savedQueryId === savedQueryId,
				);

				if (existingTab) {
					setActiveTabId(existingTab.id);
					return;
				}
			}

			const newTab = createQueryTab(query, savedQueryId, savedQueryName);
			setTabs((previous) => [...previous, newTab]);
			setActiveTabId(newTab.id);
		},
		[tabs, setTabs, setActiveTabId],
	);

	const handleNewQuery = useCallback(() => {
		const newTab = createQueryTab("SELECT * FROM ");
		setTabs((previous) => [...previous, newTab]);
		setActiveTabId(newTab.id);
	}, [setTabs, setActiveTabId]);

	const handleOpenSchemaVisualizer = useCallback(() => {
		const existingTab = tabs.find((tab) => tab.type === "schema-visualizer");

		if (existingTab) {
			setActiveTabId(existingTab.id);
			return;
		}

		const selectedTables =
			schemaOverview?.tables.map((table) => `${table.schema}.${table.name}`) ??
			[];
		const newTab = createSchemaVisualizerTab(selectedTables);
		setTabs((previous) => [...previous, newTab]);
		setActiveTabId(newTab.id);
	}, [tabs, setTabs, setActiveTabId, schemaOverview]);

	const handleCloseTab = useCallback(
		(tabId: string) => {
			cancelTabGeneration(tabId);
			setTabs((previous) => {
				const newTabs = previous.filter((tab) => tab.id !== tabId);

				if (activeTabId === tabId && newTabs.length > 0) {
					const closedIndex = previous.findIndex((tab) => tab.id === tabId);
					const newActiveIndex = Math.min(closedIndex, newTabs.length - 1);
					setActiveTabId(newTabs[newActiveIndex].id);
				} else if (newTabs.length === 0) {
					setActiveTabId(null);
				}

				return newTabs;
			});
		},
		[activeTabId, cancelTabGeneration, setTabs, setActiveTabId],
	);

	const handleTabSelect = useCallback(
		(tabId: string) => {
			setActiveTabId(tabId);
		},
		[setActiveTabId],
	);

	useNativeCloseListener({
		kind: "tabs",
		activeTabId,
		closeTab: handleCloseTab,
	});

	const handleNextTab = useCallback(() => {
		if (tabs.length <= 1) return;
		const currentIndex = tabs.findIndex((tab) => tab.id === activeTabId);
		const nextIndex = (currentIndex + 1) % tabs.length;
		setActiveTabId(tabs[nextIndex].id);
	}, [tabs, activeTabId, setActiveTabId]);

	const handlePreviousTab = useCallback(() => {
		if (tabs.length <= 1) return;
		const currentIndex = tabs.findIndex((tab) => tab.id === activeTabId);
		const previousIndex = (currentIndex - 1 + tabs.length) % tabs.length;
		setActiveTabId(tabs[previousIndex].id);
	}, [tabs, activeTabId, setActiveTabId]);

	const handleRunQueryForTable = useCallback(
		(tableName: string) => {
			const [schema, table] = tableName.split(".");
			const query = `SELECT * FROM ${schema}.${table} LIMIT 10;`;
			handleOpenQuery(query);
		},
		[handleOpenQuery],
	);

	return {
		fetchTableStructure,
		fetchFunctionDefinition,
		fetchForeignKeys,
		handleOpenTableData,
		handleOpenTableDataWithFilter,
		handleOpenTableStructure,
		handleOpenFunctionDefinition,
		handleOpenQuery,
		handleNewQuery,
		handleOpenSchemaVisualizer,
		handleCloseTab,
		handleTabSelect,
		handleNextTab,
		handlePreviousTab,
		handleRunQueryForTable,
	};
}
