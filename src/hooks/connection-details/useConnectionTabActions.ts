import { listen } from "@tauri-apps/api/event";
import { getCurrentWindow } from "@tauri-apps/api/window";
import {
	type Dispatch,
	type SetStateAction,
	useCallback,
	useEffect,
	useEffectEvent,
} from "react";
import { createCellFilter } from "@/lib/resultFilters";
import { normalizeColumnLayout } from "@/lib/savedViews";
import { api } from "@/lib/tauri";
import {
	createFunctionDefinitionTab,
	createQueryTab,
	createSchemaVisualizerTab,
	createTableDataTab,
	createTableStructureTab,
	type ForeignKeyInfo,
	type FunctionDefinitionTab,
	type FunctionSummary,
	formatFunctionSignature,
	type SchemaOverview,
	type Tab,
	type TableColumn,
	type TableDataTab,
	type TableStructureData,
	type TableStructureTab,
} from "@/types/tabTypes";

type UpdateTab = <T extends Tab>(tabId: string, updates: Partial<T>) => void;

export interface UseConnectionTabActionsOptions {
	uuid: string | undefined;
	tabs: Tab[];
	setTabs: Dispatch<SetStateAction<Tab[]>>;
	activeTabId: string | null;
	setActiveTabId: Dispatch<SetStateAction<string | null>>;
	schemaOverview: SchemaOverview | null;
	updateTab: UpdateTab;
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
	updateTab,
	fetchTableData,
	cancelTabGeneration,
}: UseConnectionTabActionsOptions) {
	const fetchTableStructure = useCallback(
		async (tab: TableStructureTab) => {
			if (!uuid) return;

			updateTab<TableStructureTab>(tab.id, { loading: true });

			try {
				const [schema, tableName] = tab.tableName.split(".");
				const fullTableName = `${schema}.${tableName}`;

				if (schemaOverview) {
					const tableData = schemaOverview.tables.find(
						(table) => `${table.schema}.${table.name}` === fullTableName,
					);

					if (tableData) {
						updateTab<TableStructureTab>(tab.id, {
							structure: {
								columns: tableData.columns,
								indexes: tableData.indexes,
								foreign_keys: tableData.foreign_keys,
							} as TableStructureData,
							loading: false,
						});
						return;
					}
				}

				const data = await api.pool.getTableStructure(uuid, schema, tableName);

				updateTab<TableStructureTab>(tab.id, {
					structure: data as TableStructureData,
					loading: false,
				});
			} catch (error) {
				console.error("Failed to fetch table structure:", error);
				updateTab<TableStructureTab>(tab.id, {
					structure: null,
					loading: false,
				});
			}
		},
		[uuid, updateTab, schemaOverview],
	);

	const fetchFunctionDefinition = useCallback(
		async (tab: FunctionDefinitionTab) => {
			if (!uuid) return;

			updateTab<FunctionDefinitionTab>(tab.id, {
				loading: true,
				error: null,
			});

			try {
				const definition = await api.pool.getFunctionDefinition(
					uuid,
					tab.functionSummary.schema,
					tab.functionSummary.name,
					tab.functionSummary.identity_args,
				);

				updateTab<FunctionDefinitionTab>(tab.id, {
					definition,
					loading: false,
					error: null,
				});
			} catch (error) {
				console.error("Failed to fetch function definition:", error);
				const errorMessage =
					error instanceof Error ? error.message : String(error);
				updateTab<FunctionDefinitionTab>(tab.id, {
					definition: null,
					loading: false,
					error: errorMessage,
				});
			}
		},
		[uuid, updateTab],
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
						updateTab<TableDataTab>(tab.id, {
							foreignKeys: tableData.foreign_keys || [],
							columns,
							columnLayout: normalizeColumnLayout(
								tab.columnLayout,
								columns.map((column) => column.name),
							),
						});
						return;
					}
				}

				const data = await api.pool.getTableStructure(uuid, schema, tableName);
				const columns = (data.columns as TableColumn[]) || [];
				updateTab<TableDataTab>(tab.id, {
					foreignKeys: (data.foreign_keys as ForeignKeyInfo[]) || [],
					columns,
					columnLayout: normalizeColumnLayout(
						tab.columnLayout,
						columns.map((column) => column.name),
					),
				});
			} catch (error) {
				console.error("Failed to fetch foreign keys:", error);
			}
		},
		[uuid, updateTab, schemaOverview],
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

		const newTab = createSchemaVisualizerTab();
		setTabs((previous) => [...previous, newTab]);
		setActiveTabId(newTab.id);
	}, [tabs, setTabs, setActiveTabId]);

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

	const handleNativeCloseTab = useEffectEvent(() => {
		if (activeTabId) {
			handleCloseTab(activeTabId);
		} else {
			getCurrentWindow().close();
		}
	});

	useEffect(() => {
		let isMounted = true;
		let unlisten: (() => void) | undefined;

		listen("menu:close-tab", () => {
			handleNativeCloseTab();
		}).then((unlistenCloseTab) => {
			if (isMounted) {
				unlisten = unlistenCloseTab;
			} else {
				unlistenCloseTab();
			}
		});

		return () => {
			isMounted = false;
			unlisten?.();
		};
	}, []);

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
