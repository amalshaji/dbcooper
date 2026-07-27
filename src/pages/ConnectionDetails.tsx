import {
	lazy,
	Suspense,
	useEffect,
	useState,
	useMemo,
	useCallback,
	useRef,
} from "react";
import { useParams, useNavigate } from "react-router-dom";
import {
	type Tab,
	type FunctionDefinitionTab,
	type FunctionSummary,
	type TableDataTab,
	type TableStructureTab,
	type QueryTab,
	type SchemaVisualizerTab,
	type TableColumn,
	type TableStructureData,
	type ForeignKeyInfo,
	type SortConfig,
	type SchemaOverview,
	createFunctionDefinitionTab,
	createTableDataTab,
	createTableStructureTab,
	createQueryTab,
	createSchemaVisualizerTab,
	formatFunctionSignature,
} from "@/types/tabTypes";
import type { DatabaseTable } from "@/types/table";
import type { SavedQuery } from "@/types/savedQuery";
import {
	api,
	type Connection,
	type QueryHistory,
	type TableInfo,
} from "@/lib/tauri";
import { listen } from "@tauri-apps/api/event";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
	Card,
	CardContent,
	CardDescription,
	CardHeader,
	CardTitle,
} from "@/components/ui/card";
import {
	AlertDialog,
	AlertDialogAction,
	AlertDialogCancel,
	AlertDialogContent,
	AlertDialogDescription,
	AlertDialogFooter,
	AlertDialogHeader,
	AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import {
	Sidebar,
	SidebarContent,
	SidebarProvider,
	SidebarInset,
} from "@/components/ui/sidebar";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import {
	Table,
	Code,
	ArrowsClockwise,
	Plus,
	ClockCounterClockwise,
} from "@phosphor-icons/react";
import type { ColumnDef } from "@tanstack/react-table";
import { Spinner } from "@/components/ui/spinner";
import { QueryResultSheet } from "@/components/QueryResultSheet";
import { TabBar } from "@/components/TabBar";
import { useContextualSqlGeneration } from "@/hooks/useContextualSqlGeneration";
import { useQueryAiGeneration } from "@/hooks/useQueryAiGeneration";
import { useTableDataFilters } from "@/hooks/useTableDataFilters";
import { useSavedViewApplication } from "@/hooks/useSavedViewApplication";
import { RowEditSheet } from "@/components/RowEditSheet";
import { RowInsertSheet } from "@/components/RowInsertSheet";
import {
	ConnectionHeader,
	RedisConnectionHeader,
} from "@/components/connection-details/ConnectionHeaders";
import {
	ConnectionOpeningScreen,
	DatabaseIcon,
	type LoadingPhase,
} from "@/components/connection-details/ConnectionOpeningScreen";
import { FunctionDefinitionView } from "@/components/connection-details/FunctionDefinitionView";
import { ObjectExplorer } from "@/components/connection-details/ObjectExplorer";
import { TableFilterBar } from "@/components/connection-details/TableFilterBar";
import { ColumnLayoutPopover } from "@/components/connection-details/ColumnLayoutPopover";
import { SavedViewsMenu } from "@/components/connection-details/SavedViewsMenu";
import { ConnectionWelcome } from "@/components/connection-details/ConnectionWelcome";
import { DisconnectedScreen } from "@/components/connection-details/DisconnectedScreen";
import { TableStructureView } from "@/components/connection-details/TableStructureView";
import { QueryWorkspace } from "@/components/connection-details/QueryWorkspace";
import { RedisWorkspace } from "@/components/connection-details/RedisWorkspace";
import {
	ConnectionSidebarHeader,
	QueryHistoryPanel,
	SavedQueriesPanel,
} from "@/components/connection-details/ConnectionSidebarPanels";
import {
	PendingInlineChangesBar,
	TableDataGrid,
} from "@/components/connection-details/TableDataGrid";
import { CommandPalette } from "@/components/CommandPalette";
import {
	getStatementAtCursor,
	parseStatements as parseSqlStatements,
} from "@/lib/sqlParser";
import { useSettings } from "@/contexts/SettingsContext";
import { useTheme } from "@/contexts/ThemeContext";
import { getCreateTableDbType } from "@/lib/databaseCatalog";
import { createCellFilter, getFilterRequest } from "@/lib/resultFilters";
import {
	captureSavedViewState,
	hasUnappliedFilterDraft,
	normalizeColumnLayout,
} from "@/lib/savedViews";
import { supportsStructuredRowMutations } from "@/lib/databaseCapabilities";
import {
	prepareDuckDbRuntime,
	type DuckDbHelperProgress as DuckDbHelperProgressValue,
} from "@/lib/duckdbHelper";
import {
	areCellValuesEqual,
	buildWrappedQuery,
	getPrimaryKeyRowKey,
	isWrappableQuery,
	serializeRowsToCsv,
	stripTrailingSemicolon,
} from "@/lib/connection-details/queryTableState";

const SchemaVisualizer = lazy(() =>
	import("@/components/SchemaVisualizer").then((module) => ({
		default: module.SchemaVisualizer,
	})),
);

interface PendingInlineCellEdit {
	row: Record<string, unknown>;
	columnName: string;
	value: unknown;
}

export function ConnectionDetails() {
	const { uuid } = useParams<{ uuid: string }>();
	const navigate = useNavigate();
	const { openSettings } = useSettings();
	const { toggleTheme } = useTheme();
	const [connection, setConnection] = useState<Connection | null>(null);
	const [tables, setTables] = useState<DatabaseTable[]>([]);
	const [loadingPhase, setLoadingPhase] =
		useState<LoadingPhase>("fetching-config");
	const [duckDbHelperProgress, setDuckDbHelperProgress] =
		useState<DuckDbHelperProgressValue | null>(null);
	const [refreshingTables, setRefreshingTables] = useState(false);
	const [sidebarTab, setSidebarTab] = useState<
		"objects" | "queries" | "history"
	>("objects");
	const [savedQueries, setSavedQueries] = useState<SavedQuery[]>([]);
	const [loadingQueries, setLoadingQueries] = useState(false);
	const [queryHistory, setQueryHistory] = useState<QueryHistory[]>([]);
	const [loadingHistory, setLoadingHistory] = useState(false);
	const [expandedTables, setExpandedTables] = useState<Set<string>>(new Set());
	const [tableColumns, setTableColumns] = useState<
		Record<string, TableColumn[]>
	>({});
	const [schemaOverview, setSchemaOverview] = useState<SchemaOverview | null>(
		null,
	);
	const [loadingSchemaOverview, setLoadingSchemaOverview] = useState(false);
	const [connectionStatus, setConnectionStatus] = useState<
		"connected" | "disconnected"
	>("connected");
	const [connectionError, setConnectionError] = useState<string | null>(null);
	// True once we've connected at least once. Distinguishes an initial
	// connect failure (show takeover screen) from a mid-session drop after
	// data already loaded (keep the workspace, reconnect via the badge).
	const [hasEverConnected, setHasEverConnected] = useState(false);

	// Connection state always moves as a unit; funnel every transition through
	// these two so callers can't set status without its matching error/flag.
	const markConnected = useCallback(() => {
		setConnectionStatus("connected");
		setConnectionError(null);
		setHasEverConnected(true);
	}, []);
	const markDisconnected = useCallback((error: string) => {
		setConnectionStatus("disconnected");
		setConnectionError(error);
	}, []);

	// Tab state
	const [tabs, setTabs] = useState<Tab[]>([]);
	const [activeTabId, setActiveTabId] = useState<string | null>(null);

	// Save dialog state (for query tabs)
	const [saveQueryName, setSaveQueryName] = useState("");
	const [showSaveDialog, setShowSaveDialog] = useState(false);

	// Cursor position state (for cursor-based query execution)
	const [cursorLine, setCursorLine] = useState(0);
	const [cursorChar, setCursorChar] = useState(0);

	// Query delete confirmation state
	const [queryToDelete, setQueryToDelete] = useState<SavedQuery | null>(null);
	const [showQueryDeleteDialog, setShowQueryDeleteDialog] = useState(false);

	// AI generation
	const {
		generateDraft,
		cancelGeneration,
		isConfigured: aiConfigured,
	} =
		useContextualSqlGeneration({
			dbType: connection?.db_type,
			tables,
			tableColumns,
			schemaOverview,
		});

	const { getEditorAiProps, cancelTabGeneration } = useQueryAiGeneration({
		tabs,
		activeTabId,
		setTabs,
		setActiveTabId,
		generateDraft,
		cancelGeneration,
		isConfigured: aiConfigured,
	});

	// Row edit state
	const [rowEditSheetOpen, setRowEditSheetOpen] = useState(false);
	const [editingRow, setEditingRow] = useState<Record<string, unknown> | null>(
		null,
	);
	const [savingRow, setSavingRow] = useState(false);
	const [deletingRow, setDeletingRow] = useState(false);
	const [highlightedTableRow, setHighlightedTableRow] = useState<{
		tableName: string;
		rowKey: string;
	} | null>(null);
	const [pendingInlineEditsByTab, setPendingInlineEditsByTab] = useState<
		Record<string, Record<string, PendingInlineCellEdit>>
	>({});
	const [savingInlineEdits, setSavingInlineEdits] = useState(false);

	// Row insert state
	const [rowInsertSheetOpen, setRowInsertSheetOpen] = useState(false);
	const [insertingRow, setInsertingRow] = useState(false);

	// Query result sheet state
	const [queryResultSheetOpen, setQueryResultSheetOpen] = useState(false);
	const [selectedQueryRow, setSelectedQueryRow] = useState<{
		row: Record<string, unknown>;
		index: number;
	} | null>(null);

	// Command palette state
	const [commandPaletteOpen, setCommandPaletteOpen] = useState(false);

	// Ref to track if initial data loading has started
	const hasStartedLoading = useRef(false);

	const activeTab = useMemo(
		() => tabs.find((t) => t.id === activeTabId) || null,
		[tabs, activeTabId],
	);

	const totalObjectCount = useMemo(() => {
		return tables.length + (schemaOverview?.functions.length || 0);
	}, [tables, schemaOverview]);

	const objectSchemaCount = useMemo(() => {
		const schemaNames = new Set<string>();
		tables.forEach((table) => {
			schemaNames.add(table.schema);
		});
		schemaOverview?.functions.forEach((functionSummary) => {
			schemaNames.add(functionSummary.schema);
		});
		return schemaNames.size;
	}, [tables, schemaOverview]);

	const createTableDbType = getCreateTableDbType(connection?.db_type);

	useEffect(() => {
		const fetchConnection = async () => {
			if (!uuid) return;
			setLoadingPhase("fetching-config");
			try {
				const data = await api.connections.getByUuid(uuid);
				setConnection(data);
				if (data.type === "duckdb") {
					setLoadingPhase("preparing-duckdb");
					try {
						await prepareDuckDbRuntime(
							data.type,
							setDuckDbHelperProgress,
						);
					} catch (error) {
						const message =
							error instanceof Error ? error.message : String(error);
						markDisconnected(message);
						setLoadingPhase("complete");
						toast.error("Could not prepare DuckDB support", {
							description: message,
						});
						return;
					}
				}
				// For SSH connections, show the SSH tunnel phase first
				if (data.ssh_enabled) {
					setLoadingPhase("establishing-ssh");
				} else {
					setLoadingPhase("connecting");
				}
			} catch (error) {
				console.error("Failed to fetch connection:", error);
				navigate("/");
			}
		};

		if (uuid) {
			fetchConnection();
		}
	}, [uuid, navigate, markDisconnected]);

	// Tear down the pooled driver (and any SSH tunnel) when leaving this
	// connection so connections/tunnels don't leak for the app's lifetime.
	useEffect(() => {
		if (!uuid) return;
		return () => {
			api.pool.disconnect(uuid).catch(() => {});
		};
	}, [uuid]);

	const fetchSchemaOverviewData = useCallback(async () => {
		if (!uuid) return;

		setLoadingSchemaOverview(true);
		try {
			const data = await api.pool.getSchemaOverview(uuid);
			setSchemaOverview(data);

			// Extract tables list from schema overview
			const tablesList: DatabaseTable[] = data.tables.map((table) => ({
				schema: table.schema,
				name: table.name,
				type: (table.type === "view" ? "view" : "table") as "table" | "view",
			}));
			setTables(tablesList);
			markConnected();

			const tableDataMap: Record<string, TableColumn[]> = {};
			data.tables.forEach((table) => {
				const fullName = `${table.schema}.${table.name}`;
				tableDataMap[fullName] = table.columns;
			});
			setTableColumns(tableDataMap);

			// Initialize selectedTables for schema visualizer tabs if empty
			const allTableNames = data.tables.map((t) => `${t.schema}.${t.name}`);
			setTabs((prev) =>
				prev.map((tab) => {
					if (
						tab.type === "schema-visualizer" &&
						tab.selectedTables.length === 0
					) {
						return { ...tab, selectedTables: allTableNames };
					}
					return tab;
				}),
			);
		} catch (error) {
			console.error("Failed to fetch schema overview:", error);
			setSchemaOverview(null);
			setTables([]);
			const errorMessage =
				error instanceof Error ? error.message : String(error);
			markDisconnected(errorMessage);
			toast.error("Connection failed", {
				description: errorMessage,
			});
		} finally {
			setLoadingSchemaOverview(false);
		}
	}, [uuid, markConnected, markDisconnected]);

	// Reset loading flag when connection changes
	useEffect(() => {
		hasStartedLoading.current = false;
	}, [connection]);

	useEffect(() => {
		const shouldStartLoading =
			connection &&
			(loadingPhase === "connecting" || loadingPhase === "establishing-ssh") &&
			!hasStartedLoading.current;

		if (!shouldStartLoading) return;
		if (!uuid) return;

		hasStartedLoading.current = true;
		const connectionUuid = uuid;

		const loadData = async () => {
			try {
				const connectResult = await api.pool.connect(connectionUuid);

				if (connectResult.status === "connected") {
					markConnected();
					if (connection.type !== "redis") {
						setLoadingPhase("loading-schema");
						await fetchSchemaOverviewData();
					}
				} else {
					const message = connectResult.error || "Connection failed";
					markDisconnected(message);
					toast.error("Connection failed", {
						description: message,
					});
				}
			} catch (error) {
				const message = error instanceof Error ? error.message : String(error);
				markDisconnected(message);
				toast.error("Connection failed", {
					description: message,
				});
			} finally {
				setLoadingPhase("complete");
			}
		};

		loadData().catch((error) => {
			console.error("Failed to load connection data:", error);
			markDisconnected(error instanceof Error ? error.message : String(error));
			setLoadingPhase("complete");
		});
		// Only depend on connection and loadingPhase, not the callbacks
		// eslint-disable-next-line react-hooks/exhaustive-deps
	}, [connection, loadingPhase, uuid]);

	useEffect(() => {
		const fetchSavedQueries = async () => {
			if (!uuid || sidebarTab !== "queries") return;

			setLoadingQueries(true);
			try {
				const data = await api.queries.list(uuid);
				setSavedQueries(data as SavedQuery[]);
			} catch (error) {
				console.error("Failed to fetch saved queries:", error);
			} finally {
				setLoadingQueries(false);
			}
		};

		fetchSavedQueries();
	}, [uuid, sidebarTab]);

	const fetchQueryHistory = useCallback(async () => {
		if (!uuid) return;
		try {
			const data = await api.queries.history(uuid);
			setQueryHistory(data);
		} catch (error) {
			console.error("Failed to fetch query history:", error);
		}
	}, [uuid]);

	// Recording lives here, not in the backend pool_execute_query command, on
	// purpose: that command also serves internal filter/sort/pagination
	// re-queries (runQueryResultViewQuery), which must NOT pollute history.
	// Only this layer knows which executeQuery calls are user-initiated runs.
	// Fire-and-forget; a history failure must never affect the query UX.
	const recordHistory = useCallback(
		(
			query: string,
			opts: {
				status: "success" | "error";
				timeTakenMs?: number | null;
				rowCount?: number | null;
				rowsAffected?: number | null;
				error?: string | null;
			},
		) => {
			if (!uuid) return;
			api.queries
				.recordHistory({ connectionUuid: uuid, query, ...opts })
				// Only live-refresh the panel if it's actually open; otherwise the
				// tab-switch effect refetches on demand.
				.then(() => {
					if (sidebarTab === "history") fetchQueryHistory();
				})
				.catch((e) => console.error("Failed to record query history:", e));
		},
		[uuid, sidebarTab, fetchQueryHistory],
	);

	useEffect(() => {
		if (!uuid || sidebarTab !== "history") return;
		setLoadingHistory(true);
		fetchQueryHistory().finally(() => setLoadingHistory(false));
	}, [uuid, sidebarTab, fetchQueryHistory]);

	const updateTab = useCallback(
		<T extends Tab>(tabId: string, updates: Partial<T>) => {
			setTabs((prev) =>
				prev.map((t) => (t.id === tabId ? { ...t, ...updates } : t)),
			);
		},
		[],
	);

	const requestTableData = useCallback(
		async (tab: TableDataTab) => {
			if (!uuid) throw new Error("Connection is unavailable");
			const [schema, tableName] = tab.tableName.split(".");
			const filterRequest = getFilterRequest(tab.filterState.applied);
			return api.pool.getTableData(
				uuid,
				schema,
				tableName,
				tab.currentPage,
				100,
				filterRequest.filter,
				filterRequest.structuredFilter,
				tab.sort?.column,
				tab.sort?.direction,
			);
		},
		[uuid],
	);

	const fetchTableData = useCallback(
		async (tab: TableDataTab) => {
			updateTab<TableDataTab>(tab.id, { loading: true });
			try {
				const data = await requestTableData(tab);
				updateTab<TableDataTab>(tab.id, { data, loading: false });
			} catch (error) {
				console.error("Failed to fetch table data:", error);
				toast.error("Failed to load table data", {
					description: error instanceof Error ? error.message : String(error),
				});
				updateTab<TableDataTab>(tab.id, { data: null, loading: false });
			}
		},
		[requestTableData, updateTab],
	);
	const activeTableDataTab =
		activeTab?.type === "table-data" ? activeTab : null;
	const updateTableDataTab = useCallback(
		(id: string, updates: Partial<TableDataTab>) =>
			updateTab<TableDataTab>(id, updates),
		[updateTab],
	);
	const {
		setFilterState: handleTableFilterStateChange,
		applyFilter: handleApplyFilter,
		clearFilter: clearTableFilter,
		filterCell: handleCellFilter,
	} = useTableDataFilters({
		tab: activeTableDataTab,
		updateTab: updateTableDataTab,
		fetchTableData,
	});

	const handleApplySavedView = useSavedViewApplication({
		tab: activeTableDataTab,
		requestTableData,
		updateTab: updateTableDataTab,
	});

	const fetchTableStructure = useCallback(
		async (tab: TableStructureTab) => {
			if (!uuid) return;

			updateTab<TableStructureTab>(tab.id, { loading: true });

			try {
				const [schema, tableName] = tab.tableName.split(".");
				const fullTableName = `${schema}.${tableName}`;

				if (schemaOverview) {
					const tableData = schemaOverview.tables.find(
						(t) => `${t.schema}.${t.name}` === fullTableName,
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
						(t) => `${t.schema}.${t.name}` === fullTableName,
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
			// Check if tab already exists
			const existingTab = tabs.find(
				(t) =>
					t.type === "table-data" &&
					(t as TableDataTab).tableName === tableName,
			);

			if (existingTab) {
				setActiveTabId(existingTab.id);
				return;
			}

			const newTab = createTableDataTab(tableName);
			setTabs((prev) => [...prev, newTab]);
			setActiveTabId(newTab.id);

			// Fetch data and foreign keys for the new tab
			fetchTableData(newTab);
			fetchForeignKeys(newTab);
		},
		[tabs, fetchTableData, fetchForeignKeys],
	);

	const handleTableCreated = useCallback(
		(table: TableInfo) => {
			const fullTableName = `${table.schema}.${table.name}`;
			toast.success(`Created ${fullTableName}`);
			handleOpenTableData(fullTableName);
			void fetchSchemaOverviewData();
		},
		[fetchSchemaOverviewData, handleOpenTableData],
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

			setTabs((prev) => [...prev, newTab]);
			setActiveTabId(newTab.id);

			// Fetch data and foreign keys for the new tab
			fetchTableData(newTab);
			fetchForeignKeys(newTab);
		},
		[fetchTableData, fetchForeignKeys],
	);

	const handleOpenTableStructure = useCallback(
		(tableName: string) => {
			// Check if tab already exists
			const existingTab = tabs.find(
				(t) =>
					t.type === "table-structure" &&
					(t as TableStructureTab).tableName === tableName,
			);

			if (existingTab) {
				setActiveTabId(existingTab.id);
				return;
			}

			const newTab = createTableStructureTab(tableName);
			setTabs((prev) => [...prev, newTab]);
			setActiveTabId(newTab.id);

			// Fetch structure for the new tab
			fetchTableStructure(newTab);
		},
		[tabs, fetchTableStructure],
	);

	const handleOpenFunctionDefinition = useCallback(
		(functionSummary: FunctionSummary) => {
			const existingTab = tabs.find(
				(tab) =>
					tab.type === "function-definition" &&
					formatFunctionSignature(
						(tab as FunctionDefinitionTab).functionSummary,
					) === formatFunctionSignature(functionSummary),
			);

			if (existingTab) {
				setActiveTabId(existingTab.id);
				return;
			}

			const newTab = createFunctionDefinitionTab(functionSummary);
			setTabs((prev) => [...prev, newTab]);
			setActiveTabId(newTab.id);
			fetchFunctionDefinition(newTab);
		},
		[tabs, fetchFunctionDefinition],
	);

	const handleOpenQuery = useCallback(
		(
			query: string,
			savedQueryId: number | null = null,
			savedQueryName: string | null = null,
		) => {
			// Check if saved query tab already exists
			if (savedQueryId) {
				const existingTab = tabs.find(
					(t) =>
						t.type === "query" && (t as QueryTab).savedQueryId === savedQueryId,
				);

				if (existingTab) {
					setActiveTabId(existingTab.id);
					return;
				}
			}

			const newTab = createQueryTab(query, savedQueryId, savedQueryName);
			setTabs((prev) => [...prev, newTab]);
			setActiveTabId(newTab.id);
		},
		[tabs],
	);

	const handleNewQuery = useCallback(() => {
		const newTab = createQueryTab("SELECT * FROM ");
		setTabs((prev) => [...prev, newTab]);
		setActiveTabId(newTab.id);
	}, []);

	const handleOpenSchemaVisualizer = useCallback(() => {
		const existingTab = tabs.find((t) => t.type === "schema-visualizer");

		if (existingTab) {
			setActiveTabId(existingTab.id);
			return;
		}

		const newTab = createSchemaVisualizerTab();
		setTabs((prev) => [...prev, newTab]);
		setActiveTabId(newTab.id);
	}, [tabs]);

	const handleReconnect = useCallback(async () => {
		if (!uuid) return;
		const connectResult = await api.pool.connect(uuid);
		if (connectResult.status === "connected") {
			markConnected();
			toast.success("Reconnected successfully");
			if (connection?.type !== "redis") {
				await fetchSchemaOverviewData();
			}
		} else {
			const message = connectResult.error || "Connection failed";
			markDisconnected(message);
			toast.error("Reconnection failed", {
				description: message,
			});
			throw new Error(message);
		}
	}, [
		uuid,
		connection?.type,
		fetchSchemaOverviewData,
		markConnected,
		markDisconnected,
	]);

	const handleCloseTab = useCallback(
		(tabId: string) => {
			cancelTabGeneration(tabId);
			setTabs((prev) => {
				const newTabs = prev.filter((t) => t.id !== tabId);

				// If closing active tab, switch to adjacent tab
				if (activeTabId === tabId && newTabs.length > 0) {
					const closedIndex = prev.findIndex((t) => t.id === tabId);
					const newActiveIndex = Math.min(closedIndex, newTabs.length - 1);
					setActiveTabId(newTabs[newActiveIndex].id);
				} else if (newTabs.length === 0) {
					setActiveTabId(null);
				}

				return newTabs;
			});
		},
		[activeTabId, cancelTabGeneration],
	);

	const handleTabSelect = useCallback((tabId: string) => {
		setActiveTabId(tabId);
	}, []);

	// Cmd/Ctrl+W is wired to a native "Close Tab" menu item that emits
	// "menu:close-tab". Closing the active tab here (instead of letting the
	// native menu close the window) fixes the whole app closing on tab close
	// (issue #66). When no tab is open, fall back to closing the window.
	const closeActiveTabRef = useRef<() => void>(() => {});
	closeActiveTabRef.current = () => {
		if (activeTabId) {
			handleCloseTab(activeTabId);
		} else {
			getCurrentWindow().close();
		}
	};

	useEffect(() => {
		let isMounted = true;
		let unlisten: (() => void) | undefined;

		listen("menu:close-tab", () => {
			closeActiveTabRef.current();
		}).then((fn) => {
			if (isMounted) {
				unlisten = fn;
			} else {
				fn();
			}
		});

		return () => {
			isMounted = false;
			unlisten?.();
		};
	}, []);

	const handleRefreshTables = async () => {
		if (!uuid || refreshingTables) return;

		setRefreshingTables(true);
		try {
			setSchemaOverview(null);
			setTableColumns({});
			await fetchSchemaOverviewData();
		} catch (error) {
			console.error("Failed to refresh tables:", error);
			setTables([]);
		} finally {
			setRefreshingTables(false);
		}
	};

	const handleRefreshTableData = useCallback(async () => {
		if (!activeTab || activeTab.type !== "table-data" || !uuid) return;
		const tab = activeTab as TableDataTab;
		updateTab<TableDataTab>(tab.id, { currentPage: 1 });
		fetchTableData({ ...tab, currentPage: 1 });
	}, [activeTab, uuid, updateTab, fetchTableData]);

	const handlePageChange = useCallback(
		(page: number) => {
			if (!activeTab || activeTab.type !== "table-data") return;
			const tab = activeTab as TableDataTab;
			updateTab<TableDataTab>(tab.id, { currentPage: page });
			fetchTableData({ ...tab, currentPage: page });
		},
		[activeTab, updateTab, fetchTableData],
	);

	const runQueryResultViewQuery = useCallback(
		async (tab: QueryTab, nextFilter: string, nextSort: SortConfig | null) => {
			if (!uuid) return;

			if (!tab.resultBaseQuery) {
				updateTab<QueryTab>(tab.id, { executing: false });
				toast.error(
					"Query-level filter/sort is available only for SELECT-style query results",
				);
				return;
			}

			const wrappedQuery = buildWrappedQuery(
				tab.resultBaseQuery,
				nextFilter,
				nextSort,
				connection?.db_type || connection?.type,
			);

			try {
				const result = await api.pool.executeQuery(uuid, wrappedQuery);
				const executionTime = result.time_taken_ms ?? 0;

				if (result.error) {
					updateTab<QueryTab>(tab.id, {
						error: result.error,
						executionTime,
						affectedRows: null,
						executing: false,
					});
					return;
				}

				updateTab<QueryTab>(tab.id, {
					results: result.data as Record<string, unknown>[],
					success: true,
					error: null,
					executionTime,
					affectedRows: null,
					executing: false,
					filter: nextFilter,
					sort: nextSort,
				});
			} catch (error) {
				updateTab<QueryTab>(tab.id, {
					error:
						error instanceof Error
							? error.message
							: "Failed to apply query filter/sort",
					executionTime: null,
					affectedRows: null,
					executing: false,
				});
			}
		},
		[uuid, updateTab, connection?.db_type, connection?.type],
	);

	const handleQueryFilterInputChange = useCallback(
		(value: string) => {
			if (!activeTab || activeTab.type !== "query") return;
			updateTab<QueryTab>(activeTab.id, { filterInput: value });
		},
		[activeTab, updateTab],
	);

	const handleApplyQueryFilter = useCallback(() => {
		if (!activeTab || activeTab.type !== "query") return;
		const tab = activeTab as QueryTab;
		updateTab<QueryTab>(tab.id, {
			filter: tab.filterInput,
			executing: true,
			error: null,
		});
		void runQueryResultViewQuery(tab, tab.filterInput, tab.sort);
	}, [activeTab, updateTab, runQueryResultViewQuery]);

	const handleClearFilter = useCallback(() => {
		if (!activeTab) return;

		if (activeTab.type === "table-data") {
			clearTableFilter();
			return;
		}

		if (activeTab.type === "query") {
			const tab = activeTab as QueryTab;
			updateTab<QueryTab>(activeTab.id, {
				filter: "",
				filterInput: "",
				executing: true,
				error: null,
			});
			void runQueryResultViewQuery(tab, "", tab.sort);
		}
	}, [activeTab, updateTab, clearTableFilter, runQueryResultViewQuery]);

	const handleSortChange = useCallback(
		(sort: { column: string; direction: "asc" | "desc" } | null) => {
			if (!activeTab || activeTab.type !== "table-data") return;
			const tab = activeTab as TableDataTab;
			updateTab<TableDataTab>(tab.id, { sort, currentPage: 1 });
			fetchTableData({ ...tab, sort, currentPage: 1 });
		},
		[activeTab, updateTab, fetchTableData],
	);

	const handleQuerySortChange = useCallback(
		(sort: SortConfig | null) => {
			if (!activeTab || activeTab.type !== "query") return;
			const tab = activeTab as QueryTab;
			updateTab<QueryTab>(activeTab.id, {
				sort,
				executing: true,
				error: null,
			});
			void runQueryResultViewQuery(tab, tab.filter, sort);
		},
		[activeTab, updateTab, runQueryResultViewQuery],
	);

	const handleRunQueryForTable = (tableName: string) => {
		const [schema, table] = tableName.split(".");
		const query = `SELECT * FROM ${schema}.${table} LIMIT 10;`;
		handleOpenQuery(query);
	};

	const handleToggleTableExpand = async (tableName: string) => {
		const newExpanded = new Set(expandedTables);

		if (newExpanded.has(tableName)) {
			newExpanded.delete(tableName);
			setExpandedTables(newExpanded);
			return;
		}

		newExpanded.add(tableName);
		setExpandedTables(newExpanded);

		if (!tableColumns[tableName] && schemaOverview) {
			const tableData = schemaOverview.tables.find(
				(t) => `${t.schema}.${t.name}` === tableName,
			);

			if (tableData) {
				setTableColumns((prev) => ({
					...prev,
					[tableName]: tableData.columns,
				}));
			}
		}
	};

	const handleRunQuery = useCallback(async () => {
		if (!activeTab || activeTab.type !== "query" || !uuid) return;

		const tab = activeTab as QueryTab;
		if (!tab.query.trim()) {
			toast.error("Cannot execute empty query");
			return;
		}

		// Get the statement at cursor position
		// For single statements, getStatementAtCursor returns it directly
		// If null (cursor not on any statement), don't run
		const statement = getStatementAtCursor(tab.query, cursorLine, cursorChar);
		const queryToRun = statement?.text.trim() || "";

		// Don't run if no statement at cursor
		if (!queryToRun) {
			toast.error("No statement at cursor position");
			return;
		}

		updateTab<QueryTab>(tab.id, {
			executing: true,
			error: null,
			results: null,
			success: false,
			executionTime: null,
			affectedRows: null,
			filterInput: "",
			filter: "",
			sort: null,
			resultBaseQuery: null,
		});

		try {
			const result = await api.pool.executeQuery(uuid, queryToRun);
			if (result.truncated) {
				toast.warning("Result limited to 10,000 rows", {
					description: "Refine the query to load a smaller result window.",
				});
			}

			// Use backend timing if available, otherwise use 0
			const executionTime = result.time_taken_ms ?? 0;

			if (result.error) {
				updateTab<QueryTab>(tab.id, {
					error: result.error,
					executionTime,
					affectedRows: null,
					executing: false,
				});
				recordHistory(queryToRun, {
					status: "error",
					timeTakenMs: result.time_taken_ms ?? null,
					error: result.error,
				});
				return;
			}

			updateTab<QueryTab>(tab.id, {
				results: result.data as Record<string, unknown>[],
				success: true,
				executionTime,
				affectedRows: result.rows_affected ?? null,
				executing: false,
				filterInput: "",
				filter: "",
				sort: null,
				resultBaseQuery: isWrappableQuery(queryToRun)
					? stripTrailingSemicolon(queryToRun)
					: null,
			});
			recordHistory(queryToRun, {
				status: "success",
				timeTakenMs: result.time_taken_ms ?? null,
				rowCount: result.row_count ?? null,
				rowsAffected: result.rows_affected ?? null,
			});
		} catch (error) {
			const message =
				error instanceof Error ? error.message : "Failed to execute query";
			updateTab<QueryTab>(tab.id, {
				error: message,
				executionTime: null,
				affectedRows: null,
				executing: false,
			});
			recordHistory(queryToRun, { status: "error", error: message });
		}
	}, [activeTab, uuid, updateTab, cursorLine, cursorChar, recordHistory]);

	const handleRunAllQueries = useCallback(async () => {
		if (!activeTab || activeTab.type !== "query" || !uuid) return;

		const tab = activeTab as QueryTab;
		if (!tab.query.trim()) return;

		const statements = parseSqlStatements(tab.query);
		if (statements.length === 0) return;

		updateTab<QueryTab>(tab.id, {
			executing: true,
			error: null,
			results: null,
			success: false,
			executionTime: null,
			affectedRows: null,
			filterInput: "",
			filter: "",
			sort: null,
			resultBaseQuery: null,
		});

		let totalTime = 0;
		let lastResult: Record<string, unknown>[] = [];
		let lastError: string | null = null;
		let lastBaseQuery: string | null = null;
		let lastAffectedRows: number | null = null;

		try {
			for (const statement of statements) {
				const queryToRun = statement.text.trim();
				if (!queryToRun) continue;

				const result = await api.pool.executeQuery(uuid, queryToRun);
				if (result.truncated) {
					toast.warning("Result limited to 10,000 rows", {
						description: "Refine the query to load a smaller result window.",
					});
				}
				totalTime += result.time_taken_ms ?? 0;

				if (result.error) {
					lastError = result.error;
					recordHistory(queryToRun, {
						status: "error",
						timeTakenMs: result.time_taken_ms ?? null,
						error: result.error,
					});
					break;
				}

				lastResult = result.data as Record<string, unknown>[];
				lastAffectedRows = result.rows_affected ?? null;
				lastBaseQuery = isWrappableQuery(queryToRun)
					? stripTrailingSemicolon(queryToRun)
					: null;
				recordHistory(queryToRun, {
					status: "success",
					timeTakenMs: result.time_taken_ms ?? null,
					rowCount: result.row_count ?? null,
					rowsAffected: result.rows_affected ?? null,
				});
			}

			if (lastError) {
				updateTab<QueryTab>(tab.id, {
					error: lastError,
					executionTime: totalTime,
					affectedRows: null,
					executing: false,
				});
			} else {
				updateTab<QueryTab>(tab.id, {
					results: lastResult,
					success: true,
					executionTime: totalTime,
					affectedRows: lastAffectedRows,
					executing: false,
					filterInput: "",
					filter: "",
					sort: null,
					resultBaseQuery: lastBaseQuery,
				});
			}
		} catch (error) {
			updateTab<QueryTab>(tab.id, {
				error:
					error instanceof Error ? error.message : "Failed to execute queries",
				executionTime: null,
				affectedRows: null,
				executing: false,
			});
		}
	}, [activeTab, uuid, updateTab, recordHistory]);

	const handleQueryChange = useCallback(
		(query: string) => {
			if (!activeTab || activeTab.type !== "query") return;
			updateTab<QueryTab>(activeTab.id, { query });
		},
		[activeTab, updateTab],
	);

	const handleInsertQueryText = useCallback(
		(text: string) => {
			if (!activeTab || activeTab.type !== "query") return;

			const query = activeTab.query;
			const needsSpace =
				query.length > 0 &&
				!query.endsWith(" ") &&
				!query.endsWith("\n") &&
				!query.endsWith("\t");

			handleQueryChange(query + (needsSpace ? " " : "") + text);
		},
		[activeTab, handleQueryChange],
	);

	const handleCopyQueryError = async (errorMessage: string) => {
		try {
			await navigator.clipboard.writeText(errorMessage);
			toast.success("Copied to clipboard");
		} catch (error) {
			toast.error("Failed to copy error", {
				description: error instanceof Error ? error.message : String(error),
			});
		}
	};

	const handleLoadQuery = (savedQuery: SavedQuery) => {
		handleOpenQuery(savedQuery.query, savedQuery.id, savedQuery.name);
	};

	const handleSaveQuery = async () => {
		if (!activeTab || activeTab.type !== "query" || !uuid) return;
		const tab = activeTab as QueryTab;
		if (!tab.query.trim() || !saveQueryName.trim()) return;

		try {
			// Check if this is an existing saved query
			if (tab.savedQueryId) {
				// Update existing query
				const updatedQuery = await api.queries.update(tab.savedQueryId, {
					name: saveQueryName,
					query: tab.query,
				});

				setSavedQueries(
					savedQueries.map((q) =>
						q.id === tab.savedQueryId ? (updatedQuery as SavedQuery) : q,
					),
				);
				updateTab<QueryTab>(tab.id, {
					savedQueryName: updatedQuery.name,
					title: updatedQuery.name,
				});
				toast.success("Query updated successfully");
			} else {
				// Create new query
				const newQuery = await api.queries.create(uuid, {
					name: saveQueryName,
					query: tab.query,
				});

				setSavedQueries([newQuery as SavedQuery, ...savedQueries]);
				updateTab<QueryTab>(tab.id, {
					savedQueryId: newQuery.id,
					savedQueryName: newQuery.name,
					title: newQuery.name,
				});
				toast.success("Query saved successfully");
			}
			setShowSaveDialog(false);
			setSaveQueryName("");
		} catch (error) {
			console.error("Failed to save query:", error);
			toast.error("Failed to save query");
		}
	};

	const handleDeleteQuery = (query: SavedQuery) => {
		setQueryToDelete(query);
		setShowQueryDeleteDialog(true);
	};

	const confirmDeleteQuery = async () => {
		if (!queryToDelete) return;

		try {
			await api.queries.delete(queryToDelete.id);
			setSavedQueries(savedQueries.filter((q) => q.id !== queryToDelete.id));
			setShowQueryDeleteDialog(false);
			setQueryToDelete(null);
			toast.success("Query deleted successfully");
		} catch (error) {
			console.error("Failed to delete query:", error);
			toast.error("Failed to delete query");
		}
	};

	// Row editing handlers
	const handleRowClick = useCallback((row: Record<string, unknown>) => {
		setEditingRow(row);
		setRowEditSheetOpen(true);
	}, []);

	const handleSaveRow = useCallback(
		async (
			updates: Array<{ column: string; value: unknown; isRawSql: boolean }>,
		) => {
			if (
				!connection ||
				!activeTab ||
				activeTab.type !== "table-data" ||
				!editingRow
			)
				return;

			const tab = activeTab as TableDataTab;
			const [schema, tableName] = tab.tableName.split(".");

			// Get primary key columns and values
			const primaryKeyColumns = tab.columns
				.filter((col) => col.primary_key)
				.map((col) => col.name);
			const primaryKeyValues = primaryKeyColumns.map((col) => editingRow[col]);

			if (primaryKeyColumns.length === 0) {
				toast.error("Cannot update row without primary key");
				return;
			}

			setSavingRow(true);

			try {
				const result = await api.pool.updateTableRow(
					connection.uuid,
					schema,
					tableName,
					primaryKeyColumns,
					primaryKeyValues,
					updates,
				);

				if (result.error) {
					toast.error("Failed to update row", { description: result.error });
				} else {
					const rowKey = getPrimaryKeyRowKey(editingRow, tab.columns);
					if (rowKey) {
						setHighlightedTableRow({ tableName: tab.tableName, rowKey });
					}
					toast.success("Row updated successfully");
					setRowEditSheetOpen(false);
					setEditingRow(null);
					fetchTableData(tab);
				}
			} catch (error) {
				console.error("Failed to update row:", error);
				toast.error("Failed to update row", {
					description: error instanceof Error ? error.message : String(error),
				});
			} finally {
				setSavingRow(false);
			}
		},
		[connection, activeTab, editingRow, fetchTableData],
	);

	const handleInlineCellSave = useCallback(
		async (
			row: Record<string, unknown>,
			columnName: string,
			value: unknown,
		) => {
			if (!activeTab || activeTab.type !== "table-data") return;

			const tab = activeTab as TableDataTab;
			const column = tab.columns.find((col) => col.name === columnName);
			if (!column || column.primary_key) {
				throw new Error("This column cannot be edited inline");
			}

			const rowKey = getPrimaryKeyRowKey(row, tab.columns);
			if (!rowKey) {
				throw new Error("Cannot update row without primary key");
			}

			const editKey = `${rowKey}:${columnName}`;

			setPendingInlineEditsByTab((prev) => {
				const tabEdits = { ...(prev[tab.id] ?? {}) };
				if (areCellValuesEqual(row[columnName], value)) {
					delete tabEdits[editKey];
				} else {
					tabEdits[editKey] = { row, columnName, value };
				}

				if (Object.keys(tabEdits).length === 0) {
					const next = { ...prev };
					delete next[tab.id];
					return next;
				}

				return { ...prev, [tab.id]: tabEdits };
			});
			toast.success("Change staged");
		},
		[activeTab],
	);

	const handleSaveInlineChanges = useCallback(async () => {
		if (!connection || !activeTab || activeTab.type !== "table-data") return;

		const tab = activeTab as TableDataTab;
		const pendingEdits = Object.entries(pendingInlineEditsByTab[tab.id] ?? {});
		if (pendingEdits.length === 0) return;

		const primaryKeyColumns = tab.columns
			.filter((col) => col.primary_key)
			.map((col) => col.name);

		if (primaryKeyColumns.length === 0) {
			toast.error("Cannot update rows without primary key");
			return;
		}

		const [schema, tableName] = tab.tableName.split(".");
		const editsByRow = new Map<
			string,
			{
				row: Record<string, unknown>;
				updates: Array<{ column: string; value: unknown; isRawSql: boolean }>;
			}
		>();

		for (const [, edit] of pendingEdits) {
			const rowKey = getPrimaryKeyRowKey(edit.row, tab.columns);
			if (!rowKey) continue;

			const groupedEdit = editsByRow.get(rowKey) ?? {
				row: edit.row,
				updates: [],
			};
			groupedEdit.updates.push({
				column: edit.columnName,
				value: edit.value,
				isRawSql: false,
			});
			editsByRow.set(rowKey, groupedEdit);
		}

		if (editsByRow.size === 0) return;

		setSavingInlineEdits(true);
		try {
			for (const [rowKey, editGroup] of editsByRow) {
				const primaryKeyValues = primaryKeyColumns.map(
					(col) => editGroup.row[col],
				);
				const result = await api.pool.updateTableRow(
					connection.uuid,
					schema,
					tableName,
					primaryKeyColumns,
					primaryKeyValues,
					editGroup.updates,
				);

				if (result.error) {
					throw new Error(result.error);
				}

				setHighlightedTableRow({ tableName: tab.tableName, rowKey });
			}

			setPendingInlineEditsByTab((prev) => {
				const next = { ...prev };
				delete next[tab.id];
				return next;
			});
			toast.success(
				`Committed ${pendingEdits.length} inline change${pendingEdits.length === 1 ? "" : "s"}`,
			);
			await fetchTableData(tab);
		} catch (error) {
			console.error("Failed to save inline changes:", error);
			toast.error("Failed to save inline changes", {
				description: error instanceof Error ? error.message : String(error),
			});
		} finally {
			setSavingInlineEdits(false);
		}
	}, [connection, activeTab, pendingInlineEditsByTab, fetchTableData]);

	const handleDiscardInlineChanges = useCallback(() => {
		if (!activeTab || activeTab.type !== "table-data") return;

		const tab = activeTab as TableDataTab;
		const pendingEdits = pendingInlineEditsByTab[tab.id];
		if (!pendingEdits || Object.keys(pendingEdits).length === 0) return;

		setPendingInlineEditsByTab((prev) => {
			const next = { ...prev };
			delete next[tab.id];
			return next;
		});
		toast.info("Inline changes discarded");
	}, [activeTab, pendingInlineEditsByTab]);

	const handleDeleteRow = useCallback(async () => {
		if (
			!connection ||
			!activeTab ||
			activeTab.type !== "table-data" ||
			!editingRow
		)
			return;

		const tab = activeTab as TableDataTab;
		const [schema, tableName] = tab.tableName.split(".");

		// Get primary key columns and values
		const primaryKeyColumns = tab.columns
			.filter((col) => col.primary_key)
			.map((col) => col.name);
		const primaryKeyValues = primaryKeyColumns.map((col) => editingRow[col]);

		if (primaryKeyColumns.length === 0) {
			toast.error("Cannot delete row without primary key");
			return;
		}

		setDeletingRow(true);

		try {
			const result = await api.pool.deleteTableRow(
				connection.uuid,
				schema,
				tableName,
				primaryKeyColumns,
				primaryKeyValues,
			);

			if (result.error) {
				toast.error("Failed to delete row", { description: result.error });
			} else {
				toast.success("Row deleted successfully");
				setRowEditSheetOpen(false);
				setEditingRow(null);
				// Refresh table data
				fetchTableData(tab);
			}
		} catch (error) {
			console.error("Failed to delete row:", error);
			toast.error("Failed to delete row", {
				description: error instanceof Error ? error.message : String(error),
			});
		} finally {
			setDeletingRow(false);
		}
	}, [connection, activeTab, editingRow, fetchTableData]);

	const handleInsertRow = useCallback(
		async (
			values: Array<{
				column: string;
				value: unknown;
				isRawSql: boolean;
			}>,
		) => {
			if (!connection || !activeTab || activeTab.type !== "table-data") return;

			const tab = activeTab as TableDataTab;
			const [schema, tableName] = tab.tableName.split(".");

			setInsertingRow(true);

			try {
				const result = await api.pool.insertTableRow(
					connection.uuid,
					schema,
					tableName,
					values,
				);

				if (result.error) {
					toast.error("Failed to insert row", { description: result.error });
				} else {
					toast.success("Row inserted successfully");
					setRowInsertSheetOpen(false);
					// Refresh table data
					fetchTableData(tab);
				}
			} catch (error) {
				console.error("Failed to insert row:", error);
				toast.error("Failed to insert row", {
					description: error instanceof Error ? error.message : String(error),
				});
			} finally {
				setInsertingRow(false);
			}
		},
		[connection, activeTab, fetchTableData],
	);

	// Command palette handlers
	const handleNextTab = useCallback(() => {
		if (tabs.length <= 1) return;
		const currentIndex = tabs.findIndex((t) => t.id === activeTabId);
		const nextIndex = (currentIndex + 1) % tabs.length;
		setActiveTabId(tabs[nextIndex].id);
	}, [tabs, activeTabId]);

	const handlePreviousTab = useCallback(() => {
		if (tabs.length <= 1) return;
		const currentIndex = tabs.findIndex((t) => t.id === activeTabId);
		const prevIndex = (currentIndex - 1 + tabs.length) % tabs.length;
		setActiveTabId(tabs[prevIndex].id);
	}, [tabs, activeTabId]);

	const handleExportCSV = useCallback(async () => {
		if (!activeTab || activeTab.type !== "query") return;
		const tab = activeTab as QueryTab;
		if (!tab.results || tab.results.length === 0) return;

		const { save } = await import("@tauri-apps/plugin-dialog");
		const { writeTextFile } = await import("@tauri-apps/plugin-fs");
		const { revealItemInDir } = await import("@tauri-apps/plugin-opener");

		const defaultName = `query_results_${new Date()
			.toISOString()
			.slice(0, 19)
			.replace(/[:-]/g, "")}.csv`;

		const filePath = await save({
			defaultPath: defaultName,
			filters: [{ name: "CSV", extensions: ["csv"] }],
		});

		if (!filePath) return;

		const csvContent = serializeRowsToCsv(tab.results);

		try {
			await writeTextFile(filePath, csvContent);
			toast.success("CSV saved successfully", {
				action: {
					label: "Open File Location",
					onClick: () => revealItemInDir(filePath),
				},
			});
		} catch (error) {
			toast.error("Failed to save CSV", {
				description: error instanceof Error ? error.message : String(error),
			});
		}
	}, [activeTab]);

	const handleToggleSidebar = useCallback(() => {
		const sidebarTrigger = document.querySelector(
			'[data-slot="sidebar-trigger"]',
		) as HTMLElement;
		if (sidebarTrigger) {
			sidebarTrigger.click();
		}
	}, []);

	const handleSaveQueryFromPalette = useCallback(() => {
		if (!activeTab || activeTab.type !== "query") return;
		const tab = activeTab as QueryTab;
		if (!tab.query.trim()) return;
		if (tab.savedQueryName) {
			setSaveQueryName(tab.savedQueryName);
		}
		setShowSaveDialog(true);
	}, [activeTab]);

	// Global keyboard shortcuts
	useEffect(() => {
		const handleKeyDown = (e: KeyboardEvent) => {
			// Don't trigger shortcuts when typing in inputs, textareas, or code editors
			const target = e.target as HTMLElement;
			if (
				target.tagName === "INPUT" ||
				target.tagName === "TEXTAREA" ||
				target.closest(".cm-editor")
			) {
				// Allow Cmd+Enter for running queries even in editor
				if (
					e.key === "Enter" &&
					(e.metaKey || e.ctrlKey) &&
					target.closest(".cm-editor")
				) {
					return; // Let CodeMirror handle it
				}
				// Allow Cmd+K for command palette even in inputs
				if (e.key === "k" && (e.metaKey || e.ctrlKey)) {
					return; // Let command palette handle it
				}
				return;
			}

			// Cmd+K - Open command palette (handled by CommandPalette component)
			if (e.key === "k" && (e.metaKey || e.ctrlKey)) {
				return; // Handled by CommandPalette
			}

			// Cmd+N - New Query
			if (e.key === "n" && (e.metaKey || e.ctrlKey)) {
				e.preventDefault();
				handleNewQuery();
				return;
			}

			// Cmd+W (Close Tab) is owned by the native menu accelerator, which
			// emits "menu:close-tab" to the frontend (see the listener below).
			// Handling it here too would double-close tabs on platforms where
			// the webview also receives the key event.

			// Cmd+] - Next Tab
			if (e.key === "]" && (e.metaKey || e.ctrlKey) && tabs.length > 1) {
				e.preventDefault();
				handleNextTab();
				return;
			}

			// Cmd+[ - Previous Tab
			if (e.key === "[" && (e.metaKey || e.ctrlKey) && tabs.length > 1) {
				e.preventDefault();
				handlePreviousTab();
				return;
			}

			// Cmd+B - Toggle Sidebar
			if (e.key === "b" && (e.metaKey || e.ctrlKey)) {
				e.preventDefault();
				handleToggleSidebar();
				return;
			}

			// Cmd+S - Save Query (only in query tabs)
			if (
				e.key === "s" &&
				(e.metaKey || e.ctrlKey) &&
				activeTab?.type === "query"
			) {
				e.preventDefault();
				handleSaveQueryFromPalette();
				return;
			}

			// Cmd+R - Refresh
			if (
				e.key === "r" &&
				(e.metaKey || e.ctrlKey) &&
				(activeTab?.type === "query" || activeTab?.type === "table-data")
			) {
				e.preventDefault();
				if (activeTab.type === "query") {
					handleRunQuery();
				} else {
					handleRefreshTableData();
				}
				return;
			}

			// Cmd+E - Export CSV (only when there are results)
			if (
				e.key === "e" &&
				(e.metaKey || e.ctrlKey) &&
				activeTab?.type === "query" &&
				activeTab.results &&
				activeTab.results.length > 0
			) {
				e.preventDefault();
				handleExportCSV();
				return;
			}

			// Cmd+Shift+X - Clear Filter
			if (
				e.key === "x" &&
				(e.metaKey || e.ctrlKey) &&
				e.shiftKey &&
				((activeTab?.type === "table-data" && activeTab.filterState.applied) ||
					(activeTab?.type === "query" && activeTab.filter))
			) {
				e.preventDefault();
				handleClearFilter();
				return;
			}

			// Cmd+Shift+V - Schema Visualizer
			if (
				e.key === "v" &&
				(e.metaKey || e.ctrlKey) &&
				e.shiftKey &&
				connection?.type !== "redis" &&
				connection?.db_type !== "clickhouse"
			) {
				e.preventDefault();
				handleOpenSchemaVisualizer();
				return;
			}

			// Cmd+1 - Switch to Objects tab
			if (
				e.key === "1" &&
				(e.metaKey || e.ctrlKey) &&
				connection?.type !== "redis"
			) {
				e.preventDefault();
				setSidebarTab("objects");
				return;
			}

			// Cmd+2 - Switch to Queries tab
			if (
				e.key === "2" &&
				(e.metaKey || e.ctrlKey) &&
				connection?.type !== "redis"
			) {
				e.preventDefault();
				setSidebarTab("queries");
				return;
			}

			// Cmd+Backspace - Go Back
			if (e.key === "Backspace" && (e.metaKey || e.ctrlKey)) {
				e.preventDefault();
				navigate("/");
				return;
			}
		};

		document.addEventListener("keydown", handleKeyDown);
		return () => document.removeEventListener("keydown", handleKeyDown);
	}, [
		activeTab,
		tabs,
		connection,
		handleNewQuery,
		handleNextTab,
		handlePreviousTab,
		handleToggleSidebar,
		handleSaveQueryFromPalette,
		handleRunQuery,
		handleRefreshTableData,
		handleExportCSV,
		handleClearFilter,
		handleOpenSchemaVisualizer,
		navigate,
	]);

	// Memoized columns for query results
	const queryColumns = useMemo<ColumnDef<Record<string, unknown>>[]>(() => {
		if (!activeTab || activeTab.type !== "query") return [];
		const tab = activeTab as QueryTab;
		if (!tab.results || tab.results.length === 0) return [];

		const firstRow = tab.results[0];
		return Object.keys(firstRow).map((key) => ({
			accessorKey: key,
			header: key,
			cell: ({ getValue }) => {
				const value = getValue();
				if (value === null)
					return <span className="text-muted-foreground italic">null</span>;
				const rawValue =
					typeof value === "object" ? JSON.stringify(value) : String(value);
				const displayValue =
					rawValue.length > 200 ? `${rawValue.slice(0, 200)}…` : rawValue;
				return <span title={rawValue}>{displayValue}</span>;
			},
		}));
	}, [activeTab]);

	if (loadingPhase !== "complete" || connection === null) {
		return (
			<ConnectionOpeningScreen
				connection={connection}
				loadingPhase={loadingPhase}
				connectionStatus={connectionStatus}
				duckDbHelperProgress={duckDbHelperProgress}
			/>
		);
	}

	const renderTableDataContent = (tab: TableDataTab) => {
		const pendingInlineChangeCount = Object.keys(
			pendingInlineEditsByTab[tab.id] ?? {},
		).length;

		return (
			<Card className="workspace-panel">
				<CardHeader>
					<div className="flex items-center justify-between">
						<div>
							<CardTitle>{tab.tableName}</CardTitle>
							<CardDescription>
								{tab.data &&
									(() => {
										const start = (tab.currentPage - 1) * 100 + 1;
										const end = Math.min(tab.currentPage * 100, tab.data.total);
										return `Showing ${start}-${end} of ${tab.data.total} records`;
									})()}
							</CardDescription>
						</div>
						<div className="flex items-center gap-2">
							<SavedViewsMenu
								connectionUuid={uuid ?? ""}
								tableName={tab.tableName}
								currentState={captureSavedViewState(
									tab.filterState.applied,
									tab.sort,
									tab.columnLayout,
								)}
								activeViewId={tab.savedViewId}
								loading={tab.loading}
								hasUnappliedFilterDraft={hasUnappliedFilterDraft(
									tab.filterState.draft,
									tab.filterState.applied,
								)}
								onActiveViewChange={(savedViewId) =>
									updateTab<TableDataTab>(tab.id, { savedViewId })
								}
								onApply={handleApplySavedView}
							/>
							<ColumnLayoutPopover
								columns={tab.columns.map((column) => column.name)}
								layout={tab.columnLayout}
								onChange={(columnLayout) =>
									updateTab<TableDataTab>(tab.id, { columnLayout })
								}
							/>
							{connection &&
								supportsStructuredRowMutations(connection.db_type) && (
									<Button
										variant="default"
										size="sm"
										onClick={() => setRowInsertSheetOpen(true)}
										disabled={tab.loading}
									>
										<Plus className="w-4 h-4" />
										Add Row
									</Button>
								)}
							<Button
								variant="outline"
								size="sm"
								onClick={handleRefreshTableData}
								disabled={tab.loading}
							>
								{tab.loading ? (
									<Spinner />
								) : (
									<ArrowsClockwise className="w-4 h-4" />
								)}
								Refresh Data
							</Button>
						</div>
					</div>
				</CardHeader>
				<PendingInlineChangesBar
					changeCount={pendingInlineChangeCount}
					saving={savingInlineEdits}
					loading={tab.loading}
					onDiscard={handleDiscardInlineChanges}
					onCommit={() => void handleSaveInlineChanges()}
				/>
				<TableFilterBar
					state={tab.filterState}
					columns={tab.columns}
					loading={tab.loading}
					onStateChange={handleTableFilterStateChange}
					onApply={handleApplyFilter}
					onClear={handleClearFilter}
				/>
				<CardContent className="max-h-[65vh] flex flex-col">
					<TableDataGrid
						tab={tab}
						dbType={connection.db_type}
						pendingInlineEdits={pendingInlineEditsByTab[tab.id] ?? {}}
						highlightedRow={highlightedTableRow}
						onOpenTableDataWithFilter={handleOpenTableDataWithFilter}
						onInlineCellSave={handleInlineCellSave}
						onPageChange={handlePageChange}
						onRowClick={handleRowClick}
						onCellFilter={handleCellFilter}
						onSortChange={handleSortChange}
						onColumnLayoutChange={(columnLayout) =>
							updateTab<TableDataTab>(tab.id, { columnLayout })
						}
					/>
				</CardContent>
			</Card>
		);
	};

	const renderTableStructureContent = (tab: TableStructureTab) => (
		<TableStructureView tab={tab} />
	);

	const renderQueryContent = (tab: QueryTab) => (
		<QueryWorkspace
			tab={tab}
			connection={connection}
			tables={tables}
			tableColumns={tableColumns}
			queryColumns={queryColumns}
			showSaveDialog={showSaveDialog}
			saveQueryName={saveQueryName}
			setSaveQueryName={setSaveQueryName}
			setShowSaveDialog={setShowSaveDialog}
			handleSaveQuery={handleSaveQuery}
			handleQueryChange={handleQueryChange}
			handleRunQuery={handleRunQuery}
			handleRunAllQueries={handleRunAllQueries}
			getEditorAiProps={getEditorAiProps}
			setCursorLine={setCursorLine}
			setCursorChar={setCursorChar}
			handleCopyQueryError={handleCopyQueryError}
			handleExportCSV={handleExportCSV}
			handleQueryFilterInputChange={handleQueryFilterInputChange}
			handleApplyQueryFilter={handleApplyQueryFilter}
			handleClearFilter={handleClearFilter}
			handleQuerySortChange={handleQuerySortChange}
			setSelectedQueryRow={setSelectedQueryRow}
			setQueryResultSheetOpen={setQueryResultSheetOpen}
		/>
	);

	const renderEmptyState = () => (
		<ConnectionWelcome
			connection={connection}
			totalObjectCount={totalObjectCount}
			objectSchemaCount={objectSchemaCount}
			onNewQuery={handleNewQuery}
			onOpenSchemaVisualizer={handleOpenSchemaVisualizer}
		/>
	);

	// ============================================================================

	const renderSchemaVisualizerContent = (tab: SchemaVisualizerTab) => (
		<div className="h-full">
			<Suspense
				fallback={
					<div className="flex h-full items-center justify-center">
						<Spinner />
					</div>
				}
			>
				<SchemaVisualizer
					schemaOverview={schemaOverview}
					loading={loadingSchemaOverview}
					onRefresh={fetchSchemaOverviewData}
					onTableClick={handleOpenTableData}
					tableFilter={tab.tableFilter}
					onTableFilterChange={(filter) => {
						updateTab<SchemaVisualizerTab>(tab.id, { tableFilter: filter });
					}}
					selectedTables={tab.selectedTables}
					onSelectedTablesChange={(tables) => {
						updateTab<SchemaVisualizerTab>(tab.id, { selectedTables: tables });
					}}
				/>
			</Suspense>
		</div>
	);

	const renderFunctionDefinitionContent = (tab: FunctionDefinitionTab) => (
		<FunctionDefinitionView tab={tab} />
	);

	const renderActiveTabContent = () => {
		if (!activeTab) return renderEmptyState();

		switch (activeTab.type) {
			case "table-data":
				return renderTableDataContent(activeTab as TableDataTab);
			case "table-structure":
				return renderTableStructureContent(activeTab as TableStructureTab);
			case "query":
				return renderQueryContent(activeTab as QueryTab);
			case "schema-visualizer":
				return renderSchemaVisualizerContent(activeTab as SchemaVisualizerTab);
			case "function-definition":
				return renderFunctionDefinitionContent(
					activeTab as FunctionDefinitionTab,
				);
			default:
				return renderEmptyState();
		}
	};

	// Initial connect failed: show a dedicated error screen instead of the
	// empty workspace shell. A mid-session drop (after connecting at least
	// once) keeps the workspace and reconnects via the header status badge.
	const showDisconnectedScreen =
		connectionStatus === "disconnected" && !hasEverConnected;

	if (showDisconnectedScreen) {
		return (
			<DisconnectedScreen
				connectionName={connection.name}
				databaseIcon={<DatabaseIcon connection={connection} />}
				error={connectionError}
				onReconnect={handleReconnect}
				onClose={() => navigate("/")}
			/>
		);
	}

	// Redis-specific layout without sidebar or tabs
	if (connection.type === "redis") {
		return (
			<div className="workspace-canvas flex h-screen flex-col">
				<RedisConnectionHeader
					connection={connection}
					onClose={() => navigate("/")}
					connectionStatus={connectionStatus}
					onReconnect={handleReconnect}
					onStatusChange={setConnectionStatus}
					onOpenSettings={openSettings}
				/>

				<div className="min-w-0 flex-1 overflow-auto p-3">
					<RedisWorkspace connection={connection} />
				</div>
			</div>
		);
	}

	return (
		<SidebarProvider>
			<Sidebar>
				<ConnectionSidebarHeader
					connection={connection}
					refreshing={refreshingTables || loadingSchemaOverview}
					onOpenSchemaVisualizer={handleOpenSchemaVisualizer}
					onRefresh={handleRefreshTables}
				/>
				<SidebarContent className="overflow-hidden p-2">
					<Tabs
						value={sidebarTab}
						onValueChange={(v) =>
							setSidebarTab(v as "objects" | "queries" | "history")
						}
						className="h-full min-h-0"
					>
						<TabsList className="grid w-full grid-cols-3">
							<TabsTrigger value="objects">
								<Table className="size-4" />
								Objects
							</TabsTrigger>
							<TabsTrigger value="queries">
								<Code className="size-4" />
								Queries
							</TabsTrigger>
							<TabsTrigger value="history">
								<ClockCounterClockwise className="size-4" />
								History
							</TabsTrigger>
						</TabsList>
						<TabsContent value="objects" className="mt-2 min-h-0 flex-1">
							<ObjectExplorer
								schemaOverview={schemaOverview}
								loading={loadingSchemaOverview}
								expandedTables={expandedTables}
								tableColumns={tableColumns}
								onToggleTableExpand={handleToggleTableExpand}
								onOpenTableData={handleOpenTableData}
								onRunQueryForTable={handleRunQueryForTable}
								onOpenTableStructure={handleOpenTableStructure}
								onOpenFunctionDefinition={handleOpenFunctionDefinition}
								activeQueryTab={
									activeTab?.type === "query" ? (activeTab as QueryTab) : null
								}
								onInsertQueryText={handleInsertQueryText}
								createTable={
									uuid && createTableDbType
										? {
												dbType: createTableDbType,
												defaultSchema: connection.database,
												onPreview: (request) =>
													api.pool.previewCreateTable(uuid, request),
												onCreate: (request) =>
													api.pool.createTable(uuid, request),
												onCreated: handleTableCreated,
											}
										: undefined
								}
							/>
						</TabsContent>
						<SavedQueriesPanel
							loading={loadingQueries}
							queries={savedQueries}
							onLoad={handleLoadQuery}
							onDelete={handleDeleteQuery}
						/>
						<QueryHistoryPanel
							loading={loadingHistory}
							history={queryHistory}
							onOpen={handleOpenQuery}
							onClear={async () => {
								if (!uuid) return;
								try {
									await api.queries.clearHistory(uuid);
									setQueryHistory([]);
								} catch (error) {
									console.error("Failed to clear query history:", error);
								}
							}}
						/>
					</Tabs>
				</SidebarContent>
			</Sidebar>

			<SidebarInset className="workspace-canvas flex h-screen min-w-0 flex-col">
				<ConnectionHeader
					connection={connection}
					onClose={() => navigate("/")}
					connectionStatus={connectionStatus}
					onReconnect={handleReconnect}
					onStatusChange={setConnectionStatus}
					onOpenSettings={openSettings}
				/>

				<TabBar
					tabs={tabs}
					activeTabId={activeTabId}
					onTabSelect={handleTabSelect}
					onTabClose={handleCloseTab}
					onNewQuery={handleNewQuery}
				/>

				<div className="min-w-0 flex-1 overflow-auto p-3">
					{renderActiveTabContent()}
				</div>
			</SidebarInset>

			{/* Query Delete Confirmation Dialog */}
			<AlertDialog
				open={showQueryDeleteDialog}
				onOpenChange={setShowQueryDeleteDialog}
			>
				<AlertDialogContent>
					<AlertDialogHeader>
						<AlertDialogTitle>Delete Saved Query?</AlertDialogTitle>
						<AlertDialogDescription>
							Are you sure you want to delete the saved query{" "}
							<span className="font-semibold">"{queryToDelete?.name}"</span>?
							This action cannot be undone.
						</AlertDialogDescription>
					</AlertDialogHeader>
					<AlertDialogFooter>
						<AlertDialogCancel>Cancel</AlertDialogCancel>
						<AlertDialogAction
							onClick={confirmDeleteQuery}
							variant="destructive"
						>
							Delete
						</AlertDialogAction>
					</AlertDialogFooter>
				</AlertDialogContent>
			</AlertDialog>

			{/* Row Edit Sheet */}
			{activeTab && activeTab.type === "table-data" && connection && (
				<RowEditSheet
					open={rowEditSheetOpen}
					onOpenChange={(open) => {
						setRowEditSheetOpen(open);
						if (!open) setEditingRow(null);
					}}
					tableName={(activeTab as TableDataTab).tableName}
					row={editingRow}
					columns={(activeTab as TableDataTab).columns}
					dbType={
						(connection.db_type || "postgres") as
							| "postgres"
							| "sqlite"
							| "duckdb"
							| "clickhouse"
							| "d1"
					}
					onSave={handleSaveRow}
					onDelete={handleDeleteRow}
					saving={savingRow}
					deleting={deletingRow}
				/>
			)}

			{/* Row Insert Sheet */}
			{activeTab && activeTab.type === "table-data" && connection && (
				<RowInsertSheet
					open={rowInsertSheetOpen}
					onOpenChange={(open) => {
						setRowInsertSheetOpen(open);
					}}
					tableName={(activeTab as TableDataTab).tableName}
					columns={(activeTab as TableDataTab).columns}
					dbType={
						(connection.db_type || "postgres") as
							| "postgres"
							| "sqlite"
							| "duckdb"
							| "clickhouse"
							| "d1"
					}
					onInsert={handleInsertRow}
					inserting={insertingRow}
				/>
			)}

			{/* Query Result Sheet */}
			<QueryResultSheet
				open={queryResultSheetOpen}
				onOpenChange={(open) => {
					setQueryResultSheetOpen(open);
					if (!open) setSelectedQueryRow(null);
				}}
				row={selectedQueryRow?.row || null}
				rowIndex={selectedQueryRow?.index}
			/>

			{/* Command Palette */}
			<CommandPalette
				open={commandPaletteOpen}
				onOpenChange={setCommandPaletteOpen}
				activeTab={activeTab}
				tabs={tabs}
				onNavigateBack={() => navigate("/")}
				onToggleSidebar={handleToggleSidebar}
				onNewQuery={handleNewQuery}
				onCloseTab={handleCloseTab}
				onNextTab={handleNextTab}
				onPreviousTab={handlePreviousTab}
				onRunQuery={handleRunQuery}
				onSaveQuery={handleSaveQueryFromPalette}
				onRefresh={() => {
					if (activeTab?.type === "query") {
						handleRunQuery();
					} else if (activeTab?.type === "table-data") {
						handleRefreshTableData();
					}
				}}
				onExportCSV={handleExportCSV}
				onClearFilter={handleClearFilter}
				onOpenSchemaVisualizer={handleOpenSchemaVisualizer}
				onOpenTableData={handleOpenTableData}
				onOpenFunctionDefinition={handleOpenFunctionDefinition}
				onSwitchSidebarTab={setSidebarTab}
				onOpenSettings={openSettings}
				onToggleTheme={toggleTheme}
				tables={tables}
				functions={schemaOverview?.functions || []}
				connectionType={connection.type}
			/>
		</SidebarProvider>
	);
}
