import { useEffect, useState, useMemo, useCallback, useRef } from "react";
import { useVirtualizer } from "@tanstack/react-virtual";
import { format as formatSQL } from "sql-formatter";
import { useParams, useNavigate } from "react-router-dom";
import {
	type Tab,
	type TableDataTab,
	type TableStructureTab,
	type QueryTab,
	type SchemaVisualizerTab,
	type TableColumn,
	type TableStructureData,
	type ForeignKeyInfo,
	type SchemaOverview,
	createTableDataTab,
	createTableStructureTab,
	createQueryTab,
	createSchemaVisualizerTab,
} from "@/types/tabTypes";
import type { DatabaseTable } from "@/types/table";
import type { SavedQuery } from "@/types/savedQuery";
import { api, type Connection } from "@/lib/tauri";
import { listen } from "@tauri-apps/api/event";
import { toast } from "sonner";
import { PostgresqlIcon } from "@/components/icons/postgres";
import { SqliteIcon } from "@/components/icons/sqlite";
import { RedisIcon } from "@/components/icons/redis";
import { ClickhouseIcon } from "@/components/icons/clickhouse";
import { Button } from "@/components/ui/button";
import {
	Card,
	CardContent,
	CardDescription,
	CardHeader,
	CardTitle,
} from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Input } from "@/components/ui/input";
import {
	Sheet,
	SheetContent,
	SheetDescription,
	SheetHeader,
	SheetTitle,
} from "@/components/ui/sheet";
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
	SidebarGroup,
	SidebarGroupContent,
	SidebarGroupLabel,
	SidebarHeader,
	SidebarMenu,
	SidebarMenuButton,
	SidebarMenuItem,
	SidebarMenuSub,
	SidebarMenuSubItem,
	SidebarMenuSubButton,
	SidebarProvider,
	SidebarInset,
	SidebarTrigger,
	useSidebar,
} from "@/components/ui/sidebar";
import {
	Collapsible,
	CollapsibleContent,
	CollapsibleTrigger,
} from "@/components/ui/collapsible";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import {
	DropdownMenu,
	DropdownMenuContent,
	DropdownMenuItem,
	DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
	ContextMenu,
	ContextMenuContent,
	ContextMenuItem,
	ContextMenuTrigger,
} from "@/components/ui/context-menu";
import {
	Table,
	ArrowLeft,
	ArrowRight,
	Code,
	DotsThreeVertical,
	FloppyDisk,
	ArrowsClockwise,
	Database,
	CaretRight,
	CaretDown,
	Columns,
	DownloadSimple,
	MagnifyingGlass,
	Graph,
	X,
	PlayCircle,
	Check,
	Copy,
	Plus,
	PaintBrush,
	Gear,
} from "@phosphor-icons/react";
import { DataTable } from "@/components/DataTable";
import type { ColumnDef } from "@tanstack/react-table";
import { Spinner } from "@/components/ui/spinner";
import { QueryResultSheet } from "@/components/QueryResultSheet";
import { SqlEditor } from "@/components/SqlEditor";
import { TabBar } from "@/components/TabBar";
import { useAIGeneration } from "@/hooks/useAIGeneration";
import { RowEditSheet } from "@/components/RowEditSheet";
import { RowInsertSheet } from "@/components/RowInsertSheet";
import { RedisKeySheet } from "@/components/RedisKeySheet";
import { ExpandableText } from "@/components/ExpandableText";
import { ConnectionStatus } from "@/components/ConnectionStatus";
import { handleDragStart } from "@/lib/windowDrag";
import { SchemaVisualizer } from "@/components/SchemaVisualizer";
import { CommandPalette } from "@/components/CommandPalette";
import {
	getStatementAtCursor,
	parseStatements as parseSqlStatements,
} from "@/lib/sqlParser";
import { useSettings } from "@/contexts/SettingsContext";

type LoadingPhase =
	| "fetching-config"
	| "establishing-ssh"
	| "connecting"
	| "loading-schema"
	| "complete";

// Header component that uses useSidebar for conditional padding
function ContentHeader({
	connection,
	navigate,
	connectionStatus,
	onReconnect,
	onStatusChange,
	onOpenSettings,
}: {
	connection: Connection;
	navigate: (path: string) => void;
	connectionStatus: "connected" | "disconnected";
	onReconnect: () => Promise<void>;
	onStatusChange: (status: "connected" | "disconnected") => void;
	onOpenSettings: () => void;
}) {
	const { state } = useSidebar();
	const isCollapsed = state === "collapsed";

	return (
		<header
			onMouseDown={handleDragStart}
			className={`flex h-12 shrink-0 items-center gap-2 border-b px-4 bg-background sticky top-0 z-20 select-none ${
				isCollapsed ? "pl-20" : ""
			}`}
		>
			<SidebarTrigger className="-ml-1" />
			<div className="flex items-center gap-2 flex-1">
				<Button
					variant="ghost"
					size="sm"
					onClick={() => navigate("/")}
					className="gap-2"
				>
					<X className="w-4 h-4" />
					Close Connection
				</Button>
			</div>
			<div className="flex items-center gap-3">
				<ConnectionStatus
					connectionUuid={connection.uuid}
					initialStatus={connectionStatus}
					onReconnect={onReconnect}
					onStatusChange={onStatusChange}
				/>
				<Badge variant="secondary" className="capitalize">
					{connection.type}
				</Badge>
				<Badge variant={connection.ssl ? "default" : "secondary"}>
					SSL: {connection.ssl ? "Yes" : "No"}
				</Badge>
				<Button variant="ghost" size="icon-sm" onClick={onOpenSettings}>
					<Gear className="w-4 h-4" />
				</Button>
			</div>
		</header>
	);
}

// Simplified header for Redis (no sidebar)
function RedisContentHeader({
	connection,
	navigate,
	connectionStatus,
	onReconnect,
	onStatusChange,
	onOpenSettings,
}: {
	connection: Connection;
	navigate: (path: string) => void;
	connectionStatus: "connected" | "disconnected";
	onReconnect: () => Promise<void>;
	onStatusChange: (status: "connected" | "disconnected") => void;
	onOpenSettings: () => void;
}) {
	return (
		<header
			onMouseDown={handleDragStart}
			className="flex h-12 shrink-0 items-center gap-2 border-b pl-20 pr-4 bg-background sticky top-0 z-20 select-none"
		>
			<div className="flex items-center gap-2 flex-1 ml-4">
				<Button
					variant="ghost"
					size="sm"
					onClick={() => navigate("/")}
					className="gap-2"
				>
					<X className="w-4 h-4" />
					Close Connection
				</Button>
				<span className="font-semibold">{connection.name}</span>
				<span className="text-muted-foreground text-sm">
					{connection.host}:{connection.port}
				</span>
			</div>
			<div className="flex items-center gap-3">
				<ConnectionStatus
					connectionUuid={connection.uuid}
					initialStatus={connectionStatus}
					onReconnect={onReconnect}
					onStatusChange={onStatusChange}
				/>
				<Badge variant="secondary" className="capitalize">
					{connection.type}
				</Badge>
				<Button variant="ghost" size="icon-sm" onClick={onOpenSettings}>
					<Gear className="w-4 h-4" />
				</Button>
			</div>
		</header>
	);
}

export function ConnectionDetails() {
	const { uuid } = useParams<{ uuid: string }>();
	const navigate = useNavigate();
	const { openSettings } = useSettings();
	const [connection, setConnection] = useState<Connection | null>(null);
	const [tables, setTables] = useState<DatabaseTable[]>([]);
	const [loadingPhase, setLoadingPhase] =
		useState<LoadingPhase>("fetching-config");
	const [refreshingTables, setRefreshingTables] = useState(false);
	const [sidebarTab, setSidebarTab] = useState<"tables" | "queries">("tables");
	const [tableSearchQuery, setTableSearchQuery] = useState("");
	const [savedQueries, setSavedQueries] = useState<SavedQuery[]>([]);
	const [loadingQueries, setLoadingQueries] = useState(false);
	const [expandedTables, setExpandedTables] = useState<Set<string>>(new Set());
	const [tableColumns, setTableColumns] = useState<
		Record<string, TableColumn[]>
	>({});
	const [loadingColumns, setLoadingColumns] = useState<Set<string>>(new Set());
	const [schemaOverview, setSchemaOverview] = useState<SchemaOverview | null>(
		null,
	);
	const [loadingSchemaOverview, setLoadingSchemaOverview] = useState(false);
	const [connectionStatus, setConnectionStatus] = useState<
		"connected" | "disconnected"
	>("connected");

	// Tab state
	const [tabs, setTabs] = useState<Tab[]>([]);
	const [activeTabId, setActiveTabId] = useState<string | null>(null);

	// Redis-specific state (no tabs for Redis)
	const [redisPattern, setRedisPattern] = useState("*");
	const [redisKeys, setRedisKeys] = useState<any[] | null>(null);
	const [redisSelectedKey, setRedisSelectedKey] = useState<string | null>(null);
	const [redisKeyDetails, setRedisKeyDetails] = useState<any>(null);
	const [loadingRedisKeys, setLoadingRedisKeys] = useState(false);
	const [loadingRedisDetails, setLoadingRedisDetails] = useState(false);
	const [redisSheetOpen, setRedisSheetOpen] = useState(false);
	const [copiedToClipboard, setCopiedToClipboard] = useState(false);
	const [showDeleteDialog, setShowDeleteDialog] = useState(false);
	const [redisSearchTime, setRedisSearchTime] = useState<number | null>(null);
	const [redisKeySheetOpen, setRedisKeySheetOpen] = useState(false);
	const [redisKeySheetMode, setRedisKeySheetMode] = useState<"add" | "edit">(
		"add",
	);
	const [savingRedisKey, setSavingRedisKey] = useState(false);
	const [redisScanProgress, setRedisScanProgress] = useState<{
		iteration: number;
		maxIterations: number;
		keysFound: number;
	} | null>(null);
	const [redisScanCursor, setRedisScanCursor] = useState<number | null>(null);
	const [redisScanComplete, setRedisScanComplete] = useState<boolean>(true);
	const [redisScanBaseCount, setRedisScanBaseCount] = useState<number>(0);

	// Ref for Redis keys list virtualization
	const redisKeysListRef = useRef<HTMLDivElement>(null);

	// Virtualizer for Redis keys list
	const redisKeysVirtualizer = useVirtualizer({
		count: redisKeys?.length ?? 0,
		getScrollElement: () => redisKeysListRef.current,
		estimateSize: () => 48,
		overscan: 10,
	});

	// Listen for Redis scan progress events
	useEffect(() => {
		if (!uuid) return;

		let isMounted = true;
		let unlistenFn: (() => void) | null = null;

		const setupListener = async () => {
			const unlisten = await listen<{
				uuid: string;
				iteration: number;
				max_iterations: number;
				keys_found: number;
				keys: string[];
			}>("redis-scan-progress", (event) => {
				if (event.payload.uuid === uuid) {
					setRedisScanProgress({
						iteration: event.payload.iteration,
						maxIterations: event.payload.max_iterations,
						keysFound: event.payload.keys_found,
					});
					// Append new keys as they stream in
					if (event.payload.keys.length > 0) {
						setRedisKeys((prev) => {
							const newKeys = event.payload.keys.map((key) => ({
								key,
								key_type: "",
								ttl: -2,
								size: null,
							}));
							return [...(prev || []), ...newKeys];
						});
					}
				}
			});

			if (isMounted) {
				unlistenFn = unlisten;
			} else {
				unlisten();
			}
		};

		setupListener();

		return () => {
			isMounted = false;
			unlistenFn?.();
		};
	}, [uuid]);

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
	const [isAiGenerating, setIsAiGenerating] = useState(false);
	const { generateSQL, isConfigured: aiConfigured } = useAIGeneration();

	// Row edit state
	const [rowEditSheetOpen, setRowEditSheetOpen] = useState(false);
	const [editingRow, setEditingRow] = useState<Record<string, unknown> | null>(
		null,
	);
	const [savingRow, setSavingRow] = useState(false);
	const [deletingRow, setDeletingRow] = useState(false);

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

	const filteredTables = useMemo(() => {
		if (!tableSearchQuery.trim()) {
			return tables;
		}
		const query = tableSearchQuery.toLowerCase();
		return tables.filter(
			(table) =>
				table.name.toLowerCase().includes(query) ||
				table.schema.toLowerCase().includes(query) ||
				`${table.schema}.${table.name}`.toLowerCase().includes(query),
		);
	}, [tables, tableSearchQuery]);

	const tablesBySchema = useMemo(() => {
		return filteredTables.reduce(
			(acc, table) => {
				if (!acc[table.schema]) {
					acc[table.schema] = [];
				}
				acc[table.schema].push(table);
				return acc;
			},
			{} as Record<string, DatabaseTable[]>,
		);
	}, [filteredTables]);

	useEffect(() => {
		const fetchConnection = async () => {
			if (!uuid) return;
			setLoadingPhase("fetching-config");
			try {
				const data = await api.connections.getByUuid(uuid);
				setConnection(data);
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
	}, [uuid, navigate]);

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
			setConnectionStatus("connected");

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
			setConnectionStatus("disconnected");
			const errorMessage =
				error instanceof Error ? error.message : String(error);
			toast.error("Connection failed", {
				description: errorMessage,
			});
		} finally {
			setLoadingSchemaOverview(false);
		}
	}, [uuid]);

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

		hasStartedLoading.current = true;

		const loadData = async () => {
			try {
				const connectResult = await api.pool.connect(uuid!);

				if (connectResult.status === "connected") {
					setConnectionStatus("connected");
					if (connection.type !== "redis") {
						setLoadingPhase("loading-schema");
						await fetchSchemaOverviewData();
					}
				} else {
					setConnectionStatus("disconnected");
					toast.error("Connection failed", {
						description: connectResult.error || "Connection failed",
					});
				}
			} catch (error) {
				setConnectionStatus("disconnected");
				toast.error("Connection failed", {
					description: error instanceof Error ? error.message : String(error),
				});
			} finally {
				setLoadingPhase("complete");
			}
		};

		loadData().catch((error) => {
			console.error("Failed to load connection data:", error);
			setConnectionStatus("disconnected");
			setLoadingPhase("complete");
		});
		// Only depend on connection and loadingPhase, not the callbacks
		// eslint-disable-next-line react-hooks/exhaustive-deps
	}, [connection, loadingPhase]);

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

	const updateTab = useCallback(
		<T extends Tab>(tabId: string, updates: Partial<T>) => {
			setTabs((prev) =>
				prev.map((t) => (t.id === tabId ? { ...t, ...updates } : t)),
			);
		},
		[],
	);

	const fetchTableData = useCallback(
		async (tab: TableDataTab) => {
			if (!uuid) return;

			updateTab<TableDataTab>(tab.id, { loading: true });

			try {
				const [schema, tableName] = tab.tableName.split(".");
				const data = await api.pool.getTableData(
					uuid,
					schema,
					tableName,
					tab.currentPage,
					100,
					tab.filter || undefined,
					tab.sort?.column,
					tab.sort?.direction,
				);

				updateTab<TableDataTab>(tab.id, { data, loading: false });
			} catch (error) {
				console.error("Failed to fetch table data:", error);
				const errorMessage =
					error instanceof Error ? error.message : String(error);
				toast.error("Failed to load table data", {
					description: errorMessage,
				});
				updateTab<TableDataTab>(tab.id, { data: null, loading: false });
			}
		},
		[uuid, updateTab],
	);

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
						updateTab<TableDataTab>(tab.id, {
							foreignKeys: tableData.foreign_keys || [],
							columns: tableData.columns || [],
						});
						return;
					}
				}

				const data = await api.pool.getTableStructure(uuid, schema, tableName);
				updateTab<TableDataTab>(tab.id, {
					foreignKeys: (data.foreign_keys as ForeignKeyInfo[]) || [],
					columns: (data.columns as TableColumn[]) || [],
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

	const handleOpenTableDataWithFilter = useCallback(
		(tableName: string, filterColumn: string, filterValue: unknown) => {
			const filterStr =
				typeof filterValue === "string"
					? `${filterColumn} = '${filterValue}'`
					: `${filterColumn} = ${filterValue}`;

			const newTab = createTableDataTab(tableName);
			newTab.filter = filterStr;
			newTab.filterInput = filterStr;

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

	const handleRefreshSchemaOverview = useCallback(async () => {
		if (!uuid) return;
		await fetchSchemaOverviewData();
	}, [uuid, fetchSchemaOverviewData]);

	const handleReconnect = useCallback(async () => {
		if (!uuid) return;
		const connectResult = await api.pool.connect(uuid);
		if (connectResult.status === "connected") {
			setConnectionStatus("connected");
			toast.success("Reconnected successfully");
			if (connection?.type !== "redis") {
				await fetchSchemaOverviewData();
			}
		} else {
			toast.error("Reconnection failed", {
				description: connectResult.error || "Connection failed",
			});
			throw new Error(connectResult.error || "Connection failed");
		}
	}, [uuid, connection?.type, fetchSchemaOverviewData]);

	const handleCloseTab = useCallback(
		(tabId: string) => {
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
		[activeTabId],
	);

	const handleTabSelect = useCallback((tabId: string) => {
		setActiveTabId(tabId);
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

	const handleFilterInputChange = useCallback(
		(value: string) => {
			if (!activeTab || activeTab.type !== "table-data") return;
			updateTab<TableDataTab>(activeTab.id, { filterInput: value });
		},
		[activeTab, updateTab],
	);

	const handleApplyFilter = useCallback(() => {
		if (!activeTab || activeTab.type !== "table-data") return;
		const tab = activeTab as TableDataTab;
		updateTab<TableDataTab>(tab.id, {
			filter: tab.filterInput,
			currentPage: 1,
		});
		fetchTableData({ ...tab, filter: tab.filterInput, currentPage: 1 });
	}, [activeTab, updateTab, fetchTableData]);

	const handleClearFilter = useCallback(() => {
		if (!activeTab || activeTab.type !== "table-data") return;
		const tab = activeTab as TableDataTab;
		updateTab<TableDataTab>(tab.id, {
			filter: "",
			filterInput: "",
			currentPage: 1,
		});
		fetchTableData({ ...tab, filter: "", currentPage: 1 });
	}, [activeTab, updateTab, fetchTableData]);

	const handleSortChange = useCallback(
		(sort: { column: string; direction: "asc" | "desc" } | null) => {
			if (!activeTab || activeTab.type !== "table-data") return;
			const tab = activeTab as TableDataTab;
			updateTab<TableDataTab>(tab.id, { sort, currentPage: 1 });
			fetchTableData({ ...tab, sort, currentPage: 1 });
		},
		[activeTab, updateTab, fetchTableData],
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
		});

		try {
			const result = await api.pool.executeQuery(uuid, queryToRun);

			// Use backend timing if available, otherwise use 0
			const executionTime = result.time_taken_ms ?? 0;

			if (result.error) {
				updateTab<QueryTab>(tab.id, {
					error: result.error,
					executionTime,
					executing: false,
				});
				return;
			}

			updateTab<QueryTab>(tab.id, {
				results: result.data as Record<string, unknown>[],
				success: true,
				executionTime,
				executing: false,
			});
		} catch (error) {
			updateTab<QueryTab>(tab.id, {
				error:
					error instanceof Error ? error.message : "Failed to execute query",
				executionTime: null,
				executing: false,
			});
		}
	}, [activeTab, uuid, updateTab, cursorLine, cursorChar]);

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
		});

		let totalTime = 0;
		let lastResult: Record<string, unknown>[] = [];
		let lastError: string | null = null;

		try {
			for (const statement of statements) {
				const queryToRun = statement.text.trim();
				if (!queryToRun) continue;

				const result = await api.pool.executeQuery(uuid, queryToRun);
				totalTime += result.time_taken_ms ?? 0;

				if (result.error) {
					lastError = result.error;
					break;
				}

				lastResult = result.data as Record<string, unknown>[];
			}

			if (lastError) {
				updateTab<QueryTab>(tab.id, {
					error: lastError,
					executionTime: totalTime,
					executing: false,
				});
			} else {
				updateTab<QueryTab>(tab.id, {
					results: lastResult,
					success: true,
					executionTime: totalTime,
					executing: false,
				});
			}
		} catch (error) {
			updateTab<QueryTab>(tab.id, {
				error:
					error instanceof Error ? error.message : "Failed to execute queries",
				executionTime: null,
				executing: false,
			});
		}
	}, [activeTab, uuid, updateTab]);

	const handleQueryChange = useCallback(
		(query: string) => {
			if (!activeTab || activeTab.type !== "query") return;
			updateTab<QueryTab>(activeTab.id, { query });
		},
		[activeTab, updateTab],
	);

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
					toast.success("Row updated successfully");
					setRowEditSheetOpen(false);
					setEditingRow(null);
					// Refresh table data
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

		const headers = Object.keys(tab.results[0]);
		const csvContent = [
			headers.join(","),
			...tab.results.map((row) =>
				headers
					.map((header) => {
						const value = row[header];
						if (value === null || value === undefined) return "";
						const stringValue =
							typeof value === "object" ? JSON.stringify(value) : String(value);
						if (
							stringValue.includes(",") ||
							stringValue.includes('"') ||
							stringValue.includes("\n")
						) {
							return `"${stringValue.replace(/"/g, '""')}"`;
						}
						return stringValue;
					})
					.join(","),
			),
		].join("\n");

		try {
			await writeTextFile(filePath, csvContent);
			toast.success("CSV saved successfully", {
				action: {
					label: "Show in Finder",
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

			// Cmd+W - Close Tab
			if (e.key === "w" && (e.metaKey || e.ctrlKey) && activeTabId) {
				e.preventDefault();
				handleCloseTab(activeTabId);
				return;
			}

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
				activeTab?.type === "table-data" &&
				activeTab.filter
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

			// Cmd+1 - Switch to Tables tab
			if (
				e.key === "1" &&
				(e.metaKey || e.ctrlKey) &&
				connection?.type !== "redis"
			) {
				e.preventDefault();
				setSidebarTab("tables");
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
		activeTabId,
		tabs,
		connection,
		handleNewQuery,
		handleCloseTab,
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

	// Memoized columns for table data
	const tableDataColumns = useMemo<ColumnDef<Record<string, unknown>>[]>(() => {
		if (!activeTab || activeTab.type !== "table-data") return [];
		const tab = activeTab as TableDataTab;
		if (!tab.data || tab.data.data.length === 0) return [];

		const schema = tab.tableName.split(".")[0];
		const firstRow = tab.data.data[0];
		return Object.keys(firstRow).map((key) => {
			const fkInfo = tab.foreignKeys.find((fk) => fk.column === key);
			const columnInfo = tab.columns.find((col) => col.name === key);

			return {
				accessorKey: key,
				header: () => (
					<span className="flex flex-col">
						<span className="flex items-center gap-1">
							{key}
							{fkInfo && (
								<span className="text-[10px] text-muted-foreground">(FK)</span>
							)}
						</span>
						{columnInfo && (
							<span
								className="text-[10px] text-muted-foreground truncate max-w-[150px]"
								title={columnInfo.type}
							>
								{columnInfo.type}
							</span>
						)}
					</span>
				),
				cell: ({ getValue }) => {
					const value = getValue();
					if (value === null)
						return <span className="text-muted-foreground italic">null</span>;

					const rawValue =
						typeof value === "object" ? JSON.stringify(value) : String(value);
					const displayValue =
						rawValue.length > 200 ? `${rawValue.slice(0, 200)}…` : rawValue;

					if (fkInfo && value !== null) {
						const refTable = `${schema}.${fkInfo.references_table}`;
						return (
							<span
								className="group/fk flex items-center gap-1"
								title={rawValue}
							>
								<span>{displayValue}</span>
								<button
									type="button"
									className="opacity-0 group-hover/fk:opacity-100 p-0.5 rounded hover:bg-muted transition-opacity cursor-pointer"
									onClick={(e) => {
										e.stopPropagation();
										handleOpenTableDataWithFilter(
											refTable,
											fkInfo.references_column,
											value,
										);
									}}
									title={`View ${fkInfo.references_table} where ${fkInfo.references_column} = ${value}`}
								>
									<ArrowRight className="w-3.5 h-3.5 text-primary" />
								</button>
							</span>
						);
					}

					return <span title={rawValue}>{displayValue}</span>;
				},
			};
		});
	}, [activeTab, handleOpenTableDataWithFilter]);

	const tableDataPageCount = useMemo(() => {
		if (!activeTab || activeTab.type !== "table-data") return 0;
		const tab = activeTab as TableDataTab;
		if (!tab.data) return 0;
		return Math.ceil(tab.data.total / tab.data.limit);
	}, [activeTab]);

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

	const getDatabaseIcon = () => {
		if (!connection) return null;
		switch (connection.type) {
			case "postgres":
				return <PostgresqlIcon className="h-16 w-16" />;
			case "sqlite":
				return <SqliteIcon className="h-16 w-16" />;
			case "redis":
				return <RedisIcon className="h-16 w-16" />;
			case "clickhouse":
				return <ClickhouseIcon className="h-16 w-16" />;
			default:
				return <Database className="h-16 w-16" />;
		}
	};

	const loadingPhases: Array<{ phase: LoadingPhase; label: string }> = [
		{ phase: "fetching-config", label: "Fetching connection details" },
		...(connection?.ssh_enabled
			? [
					{
						phase: "establishing-ssh" as LoadingPhase,
						label: "Establishing SSH tunnel and connecting",
					},
				]
			: [
					{
						phase: "connecting" as LoadingPhase,
						label: "Establishing connection",
					},
				]),
		...(connection?.type !== "redis"
			? [
					{
						phase: "loading-schema" as LoadingPhase,
						label: "Loading schema and tables",
					},
				]
			: []),
	];

	const getPhaseStatus = (phase: LoadingPhase) => {
		const phaseIndex = loadingPhases.findIndex((p) => p.phase === phase);
		const currentIndex = loadingPhases.findIndex(
			(p) => p.phase === loadingPhase,
		);

		if (phaseIndex < currentIndex) return "complete";
		if (phaseIndex === currentIndex && loadingPhase !== "complete")
			return "active";
		return "pending";
	};

	if (loadingPhase !== "complete" || connection === null) {
		return (
			<div className="flex h-screen items-center justify-center bg-background">
				<div className="flex items-center gap-8">
					<div className="animate-pulse shrink-0">{getDatabaseIcon()}</div>
					<div className="flex flex-col gap-3 min-w-[280px]">
						{loadingPhases.map((phaseInfo) => {
							const status = getPhaseStatus(phaseInfo.phase);
							// Show connection status for the connecting phase
							const isConnectingPhase = phaseInfo.phase === "connecting";
							const showConnectionStatus =
								isConnectingPhase &&
								loadingPhase !== "fetching-config" &&
								connectionStatus !== "connected";

							return (
								<div key={phaseInfo.phase} className="flex items-center gap-3">
									<div className="w-5 h-5 flex items-center justify-center shrink-0">
										{status === "complete" ? (
											<Check className="w-5 h-5 text-green-600" />
										) : status === "active" ? (
											showConnectionStatus &&
											connectionStatus === "disconnected" ? (
												<X className="w-4 h-4 text-red-600" />
											) : (
												<Spinner className="w-4 h-4" />
											)
										) : (
											<div className="w-2 h-2 rounded-full bg-muted-foreground/30" />
										)}
									</div>
									<span
										className={`text-sm flex-1 ${
											status === "complete"
												? "text-muted-foreground"
												: status === "active"
													? showConnectionStatus &&
														connectionStatus === "disconnected"
														? "text-red-600 font-medium"
														: "text-foreground font-medium"
													: "text-muted-foreground/50"
										}`}
									>
										{showConnectionStatus && connectionStatus === "disconnected"
											? "Connection failed"
											: phaseInfo.label}
									</span>
								</div>
							);
						})}
					</div>
				</div>
			</div>
		);
	}

	const renderTableDataContent = (tab: TableDataTab) => (
		<Card>
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
						<Button
							variant="default"
							size="sm"
							onClick={() => setRowInsertSheetOpen(true)}
							disabled={tab.loading}
						>
							<Plus className="w-4 h-4" />
							Add Row
						</Button>
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
			<div className="px-6 pb-4">
				<div className="flex items-center gap-2">
					<Input
						placeholder="Filter: e.g. id = 1 AND status = 'active'"
						value={tab.filterInput}
						onChange={(e: React.ChangeEvent<HTMLInputElement>) =>
							handleFilterInputChange(e.target.value)
						}
						onKeyDown={(e: React.KeyboardEvent<HTMLInputElement>) => {
							if (e.key === "Enter") {
								handleApplyFilter();
							}
						}}
						className="flex-1 font-mono text-xs"
					/>
					<Button
						size="sm"
						onClick={handleApplyFilter}
						disabled={tab.loading || !tab.filterInput.trim()}
					>
						Apply
					</Button>
					{tab.filter && (
						<Button
							size="sm"
							variant="outline"
							onClick={handleClearFilter}
							disabled={tab.loading}
						>
							Clear
						</Button>
					)}
				</div>
				{tab.filter && (
					<div className="mt-2 text-xs text-muted-foreground">
						Active filter:{" "}
						<code className="bg-muted px-1 py-0.5 rounded">{tab.filter}</code>
					</div>
				)}
			</div>
			<CardContent className="max-h-[65vh] flex flex-col">
				{tab.loading ? (
					<div className="space-y-3 h-full overflow-auto">
						<div className="flex items-center gap-2">
							{[...Array(5)].map((_, i) => (
								<Skeleton key={i} className="h-8 flex-1 rounded" />
							))}
						</div>
						{[...Array(20)].map((_, rowIndex) => (
							<div key={rowIndex} className="flex items-center gap-2">
								{[...Array(5)].map((_, colIndex) => (
									<Skeleton key={colIndex} className="h-6 flex-1 rounded" />
								))}
							</div>
						))}
					</div>
				) : tab.data && tab.data.data.length > 0 ? (
					<div className="h-[65vh] overflow-hidden">
						<DataTable
							data={tab.data.data}
							columns={tableDataColumns}
							pageCount={tableDataPageCount}
							currentPage={tab.currentPage}
							onPageChange={handlePageChange}
							onRowClick={handleRowClick}
							virtualize={tab.data.data.length > 100}
							sortable
							sort={tab.sort}
							onSortChange={handleSortChange}
						/>
					</div>
				) : (
					<p className="text-muted-foreground text-center py-8">
						No data found in this table.
					</p>
				)}
			</CardContent>
		</Card>
	);

	const renderTableStructureContent = (tab: TableStructureTab) => (
		<Card>
			<CardHeader>
				<div className="flex items-center justify-between">
					<div>
						<CardTitle>Table Structure: {tab.tableName}</CardTitle>
						<CardDescription>
							Column information, indexes, and foreign keys
						</CardDescription>
					</div>
				</div>
			</CardHeader>
			<CardContent className="space-y-6">
				{tab.loading ? (
					<div className="space-y-6">
						<div>
							<div className="flex items-center gap-2 mb-3">
								<Skeleton className="h-5 w-5 rounded" />
								<Skeleton className="h-6 w-32 rounded" />
							</div>
							<div className="space-y-2">
								<div className="flex items-center gap-2">
									{[...Array(5)].map((_, i) => (
										<Skeleton key={i} className="h-8 flex-1 rounded" />
									))}
								</div>
								{[...Array(5)].map((_, rowIndex) => (
									<div key={rowIndex} className="flex items-center gap-2">
										{[...Array(5)].map((_, colIndex) => (
											<Skeleton key={colIndex} className="h-6 flex-1 rounded" />
										))}
									</div>
								))}
							</div>
						</div>
					</div>
				) : tab.structure ? (
					<>
						<div>
							<h3 className="text-lg font-semibold mb-3 flex items-center gap-2">
								<Database className="w-5 h-5" />
								Columns ({tab.structure.columns?.length || 0})
							</h3>
							<div className="overflow-x-auto">
								<table className="w-full border-collapse border border-border">
									<thead>
										<tr className="bg-muted/50">
											<th className="border border-border px-3 py-2 text-left font-medium">
												Name
											</th>
											<th className="border border-border px-3 py-2 text-left font-medium">
												Type
											</th>
											<th className="border border-border px-3 py-2 text-left font-medium">
												Nullable
											</th>
											<th className="border border-border px-3 py-2 text-left font-medium">
												Default
											</th>
											<th className="border border-border px-3 py-2 text-left font-medium">
												Primary Key
											</th>
										</tr>
									</thead>
									<tbody>
										{tab.structure.columns?.map((column, index) => (
											<tr key={index} className="hover:bg-muted/30">
												<td className="border border-border px-3 py-2 font-mono text-xs">
													{column.name}
												</td>
												<td className="border border-border px-3 py-2 text-xs">
													{column.type}
												</td>
												<td className="border border-border px-3 py-2 text-sm">
													{column.nullable ? (
														<span className="text-green-600">✓</span>
													) : (
														<span className="text-red-600">✗</span>
													)}
												</td>
												<td className="border border-border px-3 py-2 text-xs font-mono">
													{column.default || "-"}
												</td>
												<td className="border border-border px-3 py-2 text-sm">
													{column.primary_key ? (
														<span className="text-blue-600 font-semibold">
															✓
														</span>
													) : (
														<span className="text-gray-400">-</span>
													)}
												</td>
											</tr>
										))}
									</tbody>
								</table>
							</div>
						</div>

						{tab.structure.indexes && tab.structure.indexes.length > 0 && (
							<div>
								<h3 className="text-lg font-semibold mb-3 flex items-center gap-2">
									<Table className="w-5 h-5" />
									Indexes ({tab.structure.indexes.length})
								</h3>
								<div className="overflow-x-auto">
									<table className="w-full border-collapse border border-border">
										<thead>
											<tr className="bg-muted/50">
												<th className="border border-border px-3 py-2 text-left font-medium">
													Name
												</th>
												<th className="border border-border px-3 py-2 text-left font-medium">
													Columns
												</th>
												<th className="border border-border px-3 py-2 text-left font-medium">
													Unique
												</th>
												<th className="border border-border px-3 py-2 text-left font-medium">
													Primary
												</th>
											</tr>
										</thead>
										<tbody>
											{tab.structure.indexes.map((index, idx) => (
												<tr key={idx} className="hover:bg-muted/30">
													<td className="border border-border px-3 py-2 font-mono text-xs">
														{index.name}
													</td>
													<td className="border border-border px-3 py-2 text-sm">
														{Array.isArray(index.columns)
															? index.columns.join(", ")
															: index.columns}
													</td>
													<td className="border border-border px-3 py-2 text-sm">
														{index.unique ? (
															<span className="text-orange-600">✓</span>
														) : (
															<span className="text-gray-400">-</span>
														)}
													</td>
													<td className="border border-border px-3 py-2 text-sm">
														{index.primary ? (
															<span className="text-blue-600 font-semibold">
																✓
															</span>
														) : (
															<span className="text-gray-400">-</span>
														)}
													</td>
												</tr>
											))}
										</tbody>
									</table>
								</div>
							</div>
						)}

						{tab.structure.foreign_keys &&
							tab.structure.foreign_keys.length > 0 && (
								<div>
									<h3 className="text-lg font-semibold mb-3 flex items-center gap-2">
										<ArrowLeft className="w-5 h-5" />
										Foreign Keys ({tab.structure.foreign_keys.length})
									</h3>
									<div className="overflow-x-auto">
										<table className="w-full border-collapse border border-border">
											<thead>
												<tr className="bg-muted/50">
													<th className="border border-border px-3 py-2 text-left font-medium">
														Name
													</th>
													<th className="border border-border px-3 py-2 text-left font-medium">
														Column
													</th>
													<th className="border border-border px-3 py-2 text-left font-medium">
														References
													</th>
												</tr>
											</thead>
											<tbody>
												{tab.structure.foreign_keys.map((fk, idx) => (
													<tr key={idx} className="hover:bg-muted/30">
														<td className="border border-border px-3 py-2 font-mono text-xs">
															{fk.name}
														</td>
														<td className="border border-border px-3 py-2 font-mono text-xs">
															{fk.column}
														</td>
														<td className="border border-border px-3 py-2 text-sm">
															{fk.references_table}.{fk.references_column}
														</td>
													</tr>
												))}
											</tbody>
										</table>
									</div>
								</div>
							)}
					</>
				) : (
					<p className="text-muted-foreground text-center py-8">
						Failed to load table structure.
					</p>
				)}
			</CardContent>
		</Card>
	);

	const renderQueryContent = (tab: QueryTab) => (
		<div className="space-y-4">
			<Card>
				<CardHeader>
					<div className="flex items-center justify-between">
						<div>
							<CardTitle>SQL Editor</CardTitle>
							<CardDescription>Write and execute SQL queries</CardDescription>
						</div>
						<div className="flex items-center gap-2">
							{showSaveDialog ? (
								<div className="flex items-center gap-2">
									<Input
										placeholder="Query name"
										value={saveQueryName}
										onChange={(e) => setSaveQueryName(e.target.value)}
										className="w-40"
										onKeyDown={(e) => {
											if (e.key === "Enter") {
												handleSaveQuery();
											} else if (e.key === "Escape") {
												setShowSaveDialog(false);
												setSaveQueryName("");
											}
										}}
										autoFocus
									/>
									<Button
										size="sm"
										onClick={handleSaveQuery}
										disabled={!saveQueryName.trim()}
									>
										Save
									</Button>
									<Button
										size="sm"
										variant="ghost"
										onClick={() => {
											setShowSaveDialog(false);
											setSaveQueryName("");
										}}
									>
										Cancel
									</Button>
								</div>
							) : (
								<>
									<Button
										size="sm"
										variant="outline"
										onClick={() => {
											try {
												const formatted = formatSQL(tab.query, {
													language:
														connection?.db_type === "sqlite"
															? "sqlite"
															: connection?.db_type === "clickhouse"
																? "sql"
																: connection?.db_type === "postgres"
																	? "postgresql"
																	: "postgresql",
													tabWidth: 2,
													keywordCase: "upper",
												});
												handleQueryChange(formatted);
												toast.success("SQL formatted");
											} catch (error) {
												toast.error("Failed to format SQL", {
													description:
														error instanceof Error
															? error.message
															: "Unknown error",
												});
											}
										}}
										disabled={!tab.query.trim()}
									>
										<PaintBrush className="w-4 h-4" />
										Beautify
									</Button>
									<Button
										size="sm"
										variant="outline"
										onClick={() => {
											// Pre-populate name if this is an existing saved query
											if (tab.savedQueryName) {
												setSaveQueryName(tab.savedQueryName);
											}
											setShowSaveDialog(true);
										}}
										disabled={!tab.query.trim()}
									>
										<FloppyDisk className="w-4 h-4" />
										Save Query
									</Button>
									<div className="flex">
										<Button
											size="sm"
											onClick={handleRunQuery}
											disabled={tab.executing}
											className="rounded-r-none border-r-0 -mr-1"
										>
											{tab.executing ? <Spinner /> : null}
											Run Query{" "}
											<span className="text-xs opacity-60">
												({navigator.platform.includes("Mac") ? "⌘" : "Ctrl"}
												+↵)
											</span>
										</Button>
										<DropdownMenu>
											<DropdownMenuTrigger
												render={
													<Button
														size="sm"
														className="px-1 rounded-l-none border border-border"
														disabled={tab.executing}
													>
														<CaretDown className="w-4 h-4" />
													</Button>
												}
											/>
											<DropdownMenuContent align="end">
												<DropdownMenuItem onClick={handleRunAllQueries}>
													<PlayCircle className="w-4 h-4" />
													Run All Queries
												</DropdownMenuItem>
											</DropdownMenuContent>
										</DropdownMenu>
									</div>
								</>
							)}
						</div>
					</div>
				</CardHeader>
				<CardContent>
					<SqlEditor
						value={tab.query}
						onChange={handleQueryChange}
						onRunQuery={handleRunQuery}
						height="300px"
						// disabled={!tab.query.trim()}
						tables={tables.map((t) => ({
							schema: t.schema,
							name: t.name,
							columns: tableColumns[`${t.schema}.${t.name}`],
						}))}
						onGenerateSQL={async (instruction, existingSQL) => {
							setIsAiGenerating(true);
							try {
								// Use AI to select relevant tables
								console.log(
									`[AI] Selecting relevant tables from ${tables.length} available...`,
								);
								const selectedTableNames = await api.ai.selectTablesForQuery(
									instruction,
									tables.map((t) => ({ schema: t.schema, name: t.name })),
								);
								console.log(
									`[AI] Selected ${selectedTableNames.length} tables:`,
									selectedTableNames,
								);

								// Parse selected table names (format: "schema.table")
								const selectedTables = tables.filter((t) =>
									selectedTableNames.includes(`${t.schema}.${t.name}`),
								);

								// Use schema overview if available, otherwise use tableColumns cache
								const columnsToUse = { ...tableColumns };

								if (schemaOverview) {
									schemaOverview.tables.forEach((table) => {
										const fullName = `${table.schema}.${table.name}`;
										if (selectedTableNames.includes(fullName)) {
											columnsToUse[fullName] = table.columns;
										}
									});
								}

								// Use the columns for generation
								let accumulatedSQL = "";
								await generateSQL(
									connection.db_type || "postgres",
									instruction,
									existingSQL,
									selectedTables.map((t) => ({
										schema: t.schema,
										name: t.name,
										columns: columnsToUse[`${t.schema}.${t.name}`] || [],
									})),
									(chunk) => {
										accumulatedSQL += chunk;
										handleQueryChange(accumulatedSQL);
									},
								);
							} catch (error) {
								console.error("AI generation error:", error);
								toast.error("AI generation failed", {
									description:
										error instanceof Error ? error.message : String(error),
								});
							} finally {
								setIsAiGenerating(false);
							}
						}}
						generating={isAiGenerating}
						aiConfigured={aiConfigured}
						onCursorActivity={(line, char) => {
							setCursorLine(line);
							setCursorChar(char);
						}}
					/>
				</CardContent>
			</Card>

			<Card>
				<CardHeader>
					<div className="flex items-center justify-between">
						<div>
							<div className="flex items-center gap-2">
								<CardTitle>Query Results</CardTitle>
								{tab.executionTime !== null && (
									<span className="text-xs text-muted-foreground">
										({tab.executionTime}ms)
									</span>
								)}
							</div>
							<CardDescription>
								{tab.results !== null &&
									tab.results.length > 0 &&
									`Returned ${tab.results.length} row${
										tab.results.length !== 1 ? "s" : ""
									}`}
								{tab.results !== null &&
									tab.results.length === 0 &&
									tab.success &&
									"Query executed successfully - no rows returned"}
							</CardDescription>
						</div>
						{tab.results && tab.results.length > 0 && (
							<Button
								variant="outline"
								size="sm"
								onClick={async () => {
									if (!tab.results || tab.results.length === 0) return;

									const { save } = await import("@tauri-apps/plugin-dialog");
									const { writeTextFile } = await import(
										"@tauri-apps/plugin-fs"
									);
									const { revealItemInDir } = await import(
										"@tauri-apps/plugin-opener"
									);

									const defaultName = `query_results_${new Date()
										.toISOString()
										.slice(0, 19)
										.replace(/[:-]/g, "")}.csv`;

									const filePath = await save({
										defaultPath: defaultName,
										filters: [{ name: "CSV", extensions: ["csv"] }],
									});

									if (!filePath) return;

									const headers = Object.keys(tab.results[0]);
									const csvContent = [
										headers.join(","),
										...tab.results.map((row) =>
											headers
												.map((header) => {
													const value = row[header];
													if (value === null || value === undefined) return "";
													const stringValue =
														typeof value === "object"
															? JSON.stringify(value)
															: String(value);
													if (
														stringValue.includes(",") ||
														stringValue.includes('"') ||
														stringValue.includes("\n")
													) {
														return `"${stringValue.replace(/"/g, '""')}"`;
													}
													return stringValue;
												})
												.join(","),
										),
									].join("\n");

									try {
										await writeTextFile(filePath, csvContent);
										toast.success("CSV saved successfully", {
											action: {
												label: "Show in Finder",
												onClick: () => revealItemInDir(filePath),
											},
										});
									} catch (error) {
										toast.error("Failed to save CSV", {
											description:
												error instanceof Error ? error.message : String(error),
										});
									}
								}}
							>
								<DownloadSimple className="w-4 h-4" />
								Download CSV
							</Button>
						)}
					</div>
				</CardHeader>
				<CardContent>
					{tab.executing ? (
						<div className="space-y-3">
							<div className="flex items-center gap-2">
								{[...Array(4)].map((_, i) => (
									<Skeleton key={i} className="h-8 flex-1 rounded" />
								))}
							</div>
							{[...Array(5)].map((_, rowIndex) => (
								<div key={rowIndex} className="flex items-center gap-2">
									{[...Array(4)].map((_, colIndex) => (
										<Skeleton key={colIndex} className="h-6 flex-1 rounded" />
									))}
								</div>
							))}
						</div>
					) : tab.error ? (
						<div className="rounded-md bg-destructive/10 border border-destructive/20 p-4">
							<p className="text-sm text-destructive font-medium">
								Query Error
							</p>
							<p className="text-sm text-destructive/80 mt-1">{tab.error}</p>
						</div>
					) : tab.results && tab.results.length > 0 ? (
						<div className="max-h-[85vh]">
							<DataTable
								data={tab.results}
								columns={queryColumns}
								hidePagination
								virtualize={tab.results.length > 100}
								onRowClick={(row) => {
									if (!tab.results) return;
									const index = tab.results.findIndex((r) => r === row);
									setSelectedQueryRow({ row, index });
									setQueryResultSheetOpen(true);
								}}
							/>
						</div>
					) : tab.success && tab.results && tab.results.length === 0 ? (
						<div className="text-center py-8">
							<div className="rounded-md bg-green-50 dark:bg-green-950/20 border border-green-200 dark:border-green-800 p-4 max-w-md mx-auto">
								<p className="text-sm text-green-800 dark:text-green-200 font-medium">
									✓ Query executed successfully
								</p>
								<p className="text-sm text-green-600 dark:text-green-300 mt-1">
									No rows returned
								</p>
							</div>
						</div>
					) : (
						<div className="text-center py-8 text-muted-foreground">
							<p>
								No results yet. Write a SQL query and click &quot;Run
								Query&quot; to execute it.
							</p>
						</div>
					)}
				</CardContent>
			</Card>
		</div>
	);

	const renderEmptyState = () => (
		<Card>
			<CardHeader>
				<CardTitle>Welcome</CardTitle>
				<CardDescription>
					Select a table from the sidebar or create a new query to get started
				</CardDescription>
			</CardHeader>
			<CardContent>
				<div className="space-y-2">
					<p className="text-sm text-muted-foreground">
						Click on a table to view its data, or use the &quot;+&quot; button
						to create a new SQL query.
					</p>
					<p className="text-sm text-muted-foreground">
						Found {tables.length} tables across{" "}
						{Object.keys(tablesBySchema).length} schemas.
					</p>
				</div>
			</CardContent>
		</Card>
	);

	// ============================================================================
	// Redis-specific handlers (simple view without tabs)
	// ============================================================================

	const handleRedisSearch = async () => {
		if (!connection) return;
		setLoadingRedisKeys(true);
		setRedisSelectedKey(null);
		setRedisKeyDetails(null);
		setRedisSearchTime(null);
		setRedisScanProgress(null);
		setRedisScanCursor(null);
		setRedisScanComplete(true);
		setRedisScanBaseCount(0); // Reset base count for new search
		setRedisKeys([]); // Clear keys before starting - they will be streamed in via events

		try {
			const result = await api.redis.searchKeys(
				connection.uuid,
				redisPattern,
				100,
				0,
			);
			// Keys are streamed via events, so we don't need to set them here
			// But we still need the final metadata from the result
			setRedisSearchTime(result.time_taken_ms ?? null);
			setRedisScanCursor(result.cursor);
			setRedisScanComplete(result.scan_complete);
		} catch (error) {
			console.error("Failed to search Redis keys:", error);
			toast.error("Failed to search keys");
		} finally {
			setLoadingRedisKeys(false);
			setRedisScanProgress(null);
		}
	};

	const handleRedisScanMore = async () => {
		if (!connection || redisScanComplete || redisScanCursor == null) return;
		setLoadingRedisKeys(true);
		setRedisScanProgress(null);
		setRedisScanBaseCount(redisKeys?.length ?? 0); // Track existing keys for cumulative progress

		try {
			const result = await api.redis.searchKeys(
				connection.uuid,
				redisPattern,
				100,
				redisScanCursor,
			);
			// Keys are streamed via events, so we don't need to append them here
			setRedisSearchTime((prev) => {
				const current = result.time_taken_ms;
				if (prev == null || current == null) {
					return null;
				}
				return prev + current;
			});
			setRedisScanCursor(result.cursor);
			setRedisScanComplete(result.scan_complete);
		} catch (error) {
			console.error("Failed to scan more Redis keys:", error);
			toast.error("Failed to scan more keys");
		} finally {
			setLoadingRedisKeys(false);
			setRedisScanProgress(null);
		}
	};

	const handleRedisKeySelect = async (key: string) => {
		if (!connection) return;

		setRedisSelectedKey(key);
		setLoadingRedisDetails(true);
		setRedisSheetOpen(true);

		try {
			const details = await api.redis.getKeyDetails(connection.uuid, key);
			setRedisKeyDetails(details);
		} catch (error) {
			console.error("Failed to get Redis key details:", error);
			toast.error("Failed to load key details");
			setRedisSheetOpen(false);
		} finally {
			setLoadingRedisDetails(false);
		}
	};

	const handleRedisDeleteKey = async () => {
		setShowDeleteDialog(false);
		if (!connection || !redisSelectedKey) return;

		try {
			await api.redis.deleteKey(connection.uuid, redisSelectedKey);
			toast.success("Key deleted successfully");
			// Close sheet, refresh keys list, and clear selection
			setRedisSheetOpen(false);
			handleRedisSearch();
			setRedisSelectedKey(null);
			setRedisKeyDetails(null);
		} catch (error) {
			console.error("Failed to delete Redis key:", error);
			toast.error("Failed to delete key");
		}
	};

	const handleCopyValue = () => {
		if (!redisKeyDetails) return;
		const valueString = JSON.stringify(redisKeyDetails.value, null, 2);
		navigator.clipboard.writeText(valueString);
		setCopiedToClipboard(true);
		toast.success("Copied to clipboard");
		setTimeout(() => setCopiedToClipboard(false), 2000);
	};

	const handleRedisAddKey = () => {
		setRedisKeySheetMode("add");
		setRedisKeySheetOpen(true);
	};

	const handleRedisEditKey = () => {
		setRedisKeySheetMode("edit");
		setRedisKeySheetOpen(true);
	};

	const handleRedisSaveKey = async (data: {
		key: string;
		type: "string" | "list" | "set" | "hash" | "zset";
		value: unknown;
		ttl?: number;
	}) => {
		if (!connection) return;

		setSavingRedisKey(true);
		try {
			switch (data.type) {
				case "string":
					await api.redis.setKey(
						connection.uuid,
						data.key,
						data.value as string,
						data.ttl,
					);
					break;
				case "list":
					await api.redis.setListKey(
						connection.uuid,
						data.key,
						data.value as string[],
						data.ttl,
					);
					break;
				case "set":
					await api.redis.setSetKey(
						connection.uuid,
						data.key,
						data.value as string[],
						data.ttl,
					);
					break;
				case "hash":
					await api.redis.setHashKey(
						connection.uuid,
						data.key,
						data.value as Record<string, string>,
						data.ttl,
					);
					break;
				case "zset":
					await api.redis.setZSetKey(
						connection.uuid,
						data.key,
						data.value as Array<[string, number]>,
						data.ttl,
					);
					break;
			}

			toast.success(
				`Key "${data.key}" ${redisKeySheetMode === "add" ? "created" : "updated"} successfully`,
			);
			setRedisKeySheetOpen(false);
			handleRedisSearch();
			if (redisKeySheetMode === "edit") {
				setRedisSheetOpen(false);
				setRedisSelectedKey(null);
				setRedisKeyDetails(null);
			}
		} catch (error) {
			console.error("Failed to save Redis key:", error);
			toast.error(
				`Failed to ${redisKeySheetMode === "add" ? "create" : "update"} key`,
			);
		} finally {
			setSavingRedisKey(false);
		}
	};

	const renderRedisView = () => (
		<div className="flex flex-col h-full gap-4">
			{/* Pattern Search */}
			<Card>
				<CardContent className="pt-6">
					<div className="flex items-center gap-2">
						<Input
							placeholder="Enter pattern (e.g., *, user:*, cache:*)"
							value={redisPattern}
							onChange={(e) => setRedisPattern(e.target.value)}
							onKeyDown={(e) => {
								if (e.key === "Enter" && !loadingRedisKeys) {
									handleRedisSearch();
								}
							}}
							disabled={loadingRedisKeys}
							className="flex-1 font-mono"
							autoFocus
						/>
						<Button onClick={handleRedisSearch} disabled={loadingRedisKeys}>
							{loadingRedisKeys ? <Spinner /> : null}
							Search Keys
						</Button>
						<Button onClick={handleRedisAddKey} variant="default">
							<Plus className="w-4 h-4" />
							Add Key
						</Button>
					</div>
					{redisKeys !== null && (
						<div className="mt-2 text-sm text-muted-foreground">
							Found {redisKeys.length} key{redisKeys.length !== 1 ? "s" : ""}
							{redisSearchTime !== null && (
								<span className="ml-2">• {redisSearchTime}ms</span>
							)}
						</div>
					)}
				</CardContent>
			</Card>

			{/* Results */}
			<Card className="flex-1 overflow-hidden flex flex-col">
				<CardHeader className="pb-3">
					<CardTitle className="text-base">Keys</CardTitle>
				</CardHeader>
				<CardContent
					className="flex-1 overflow-y-auto p-0"
					ref={redisKeysListRef}
				>
					{redisKeys && redisKeys.length > 0 ? (
						<div
							style={{
								height: `${redisKeysVirtualizer.getTotalSize()}px`,
								position: "relative",
							}}
						>
							{redisKeysVirtualizer.getVirtualItems().map((virtualItem) => {
								const keyInfo = redisKeys[virtualItem.index];
								return (
									<div
										key={virtualItem.key}
										data-index={virtualItem.index}
										ref={redisKeysVirtualizer.measureElement}
										style={{
											position: "absolute",
											top: 0,
											left: 0,
											width: "100%",
											height: `${virtualItem.size}px`,
											transform: `translateY(${virtualItem.start}px)`,
										}}
									>
										<button
											type="button"
											onClick={() => handleRedisKeySelect(keyInfo.key)}
											className="w-full h-full text-left px-4 hover:bg-muted/50 transition-colors border-b flex items-center"
										>
											<span className="font-mono text-sm truncate flex-1">
												{keyInfo.key}
											</span>
										</button>
									</div>
								);
							})}
						</div>
					) : loadingRedisKeys ? (
						<div className="flex flex-col items-center justify-center py-8 gap-2">
							<Spinner />
							{redisScanProgress && (
								<div className="text-sm text-muted-foreground">
									Scanning... {redisScanBaseCount + redisScanProgress.keysFound}{" "}
									keys found ({redisScanProgress.iteration}/
									{redisScanProgress.maxIterations} iterations)
								</div>
							)}
						</div>
					) : redisKeys && redisKeys.length === 0 ? (
						<div className="text-center py-12 text-muted-foreground">
							No keys found matching pattern "{redisPattern}"
							{!redisScanComplete && (
								<div className="mt-4">
									<Button
										onClick={handleRedisScanMore}
										variant="outline"
										size="sm"
									>
										Scan More Keys
									</Button>
								</div>
							)}
						</div>
					) : (
						<div className="text-center py-12 text-muted-foreground">
							Enter a pattern and click Search to find keys
						</div>
					)}
				</CardContent>
				{loadingRedisKeys && redisKeys && redisKeys.length > 0 && (
					<div className="border-t p-3 flex items-center justify-center gap-2">
						<Spinner />
						{redisScanProgress && (
							<span className="text-sm text-muted-foreground">
								Scanning... {redisScanBaseCount + redisScanProgress.keysFound}{" "}
								keys found ({redisScanProgress.iteration}/
								{redisScanProgress.maxIterations} iterations)
							</span>
						)}
					</div>
				)}
				{!redisScanComplete &&
					redisKeys &&
					redisKeys.length > 0 &&
					!loadingRedisKeys && (
						<div className="border-t p-3 flex items-center justify-center gap-2">
							<span className="text-sm text-muted-foreground">
								Scan incomplete
							</span>
							<Button onClick={handleRedisScanMore} variant="outline" size="sm">
								Scan More Keys
							</Button>
						</div>
					)}
			</Card>

			{/* Key Details Sheet */}
			<Sheet open={redisSheetOpen} onOpenChange={setRedisSheetOpen}>
				<SheetContent className="w-full sm:max-w-2xl overflow-y-auto">
					<div className="">
						{loadingRedisDetails ? (
							<>
								<SheetHeader>
									<SheetTitle>Key Details</SheetTitle>
									<SheetDescription className="flex items-center gap-2">
										<Spinner />
										Loading key details
									</SheetDescription>
								</SheetHeader>
								<div className="mt-2 space-y-6 px-4">
									{/* Metadata skeleton */}
									<div>
										<h3 className="text-sm font-medium mb-3">Metadata</h3>
										<div className="space-y-3 text-sm">
											<div>
												<span className="text-muted-foreground">Key:</span>
												<Skeleton className="mt-1 h-8 w-full rounded" />
											</div>
											<div className="grid grid-cols-2 gap-4">
												<div className="space-y-1">
													<span className="text-muted-foreground">Type:</span>
													<Skeleton className="h-4 w-16 rounded" />
												</div>
												<div className="space-y-1">
													<span className="text-muted-foreground">TTL:</span>
													<Skeleton className="h-4 w-24 rounded" />
												</div>
												<div className="space-y-1">
													<span className="text-muted-foreground">
														Encoding:
													</span>
													<Skeleton className="h-4 w-20 rounded" />
												</div>
												<div className="space-y-1">
													<span className="text-muted-foreground">Memory:</span>
													<Skeleton className="h-4 w-20 rounded" />
												</div>
											</div>
										</div>
									</div>
									{/* Value skeleton */}
									<div>
										<h3 className="text-sm font-medium mb-3">Value</h3>
										<Skeleton className="h-32 w-full rounded-md" />
									</div>
									{/* Actions skeleton */}
									<div className="flex gap-2 pt-4 border-t">
										<Skeleton className="h-9 w-24 rounded" />
										<Skeleton className="h-9 w-16 rounded" />
									</div>
								</div>
							</>
						) : redisKeyDetails ? (
							<>
								<SheetHeader>
									<SheetTitle>Key Details</SheetTitle>
									<SheetDescription>
										Viewing details for Redis key
									</SheetDescription>
								</SheetHeader>
								<div className="mt-2 space-y-6 px-4">
									{/* Key metadata */}
									<div>
										<h3 className="text-sm font-medium mb-3">Metadata</h3>
										<div className="space-y-3 text-sm">
											{/* Key - full width */}
											<div>
												<span className="text-muted-foreground">Key:</span>
												<div className="mt-1 font-mono bg-muted px-3 py-2 rounded text-xs break-all">
													{redisKeyDetails.key}
												</div>
											</div>
											{/* Other metadata in grid */}
											<div className="grid grid-cols-2 gap-4">
												<div>
													<span className="text-muted-foreground">Type:</span>
													<span className="ml-2">
														{redisKeyDetails.key_type}
													</span>
												</div>
												<div>
													<span className="text-muted-foreground">TTL:</span>
													<span className="ml-2">
														{redisKeyDetails.ttl === -1
															? "No expiration"
															: `${redisKeyDetails.ttl}s`}
													</span>
												</div>
												{redisKeyDetails.encoding && (
													<div>
														<span className="text-muted-foreground">
															Encoding:
														</span>
														<span className="ml-2">
															{redisKeyDetails.encoding}
														</span>
													</div>
												)}
												{redisKeyDetails.size !== undefined && (
													<div>
														<span className="text-muted-foreground">
															Memory:
														</span>
														<span className="ml-2">
															{redisKeyDetails.size} bytes
														</span>
													</div>
												)}
												{redisKeyDetails.length !== undefined && (
													<div>
														<span className="text-muted-foreground">
															Length:
														</span>
														<span className="ml-2">
															{redisKeyDetails.length}
														</span>
													</div>
												)}
											</div>
										</div>
									</div>

									{/* Value */}
									<div>
										<div className="flex items-center justify-between mb-3">
											<h3 className="text-sm font-medium">Value</h3>
											<Button
												variant="ghost"
												size="sm"
												onClick={handleCopyValue}
												className="h-7 px-2"
											>
												{copiedToClipboard ? (
													<>
														<Check className="w-4 h-4 mr-1" />
														Copied!
													</>
												) : (
													<>
														<Copy className="w-4 h-4 mr-1" />
														Copy
													</>
												)}
											</Button>
										</div>
										<ExpandableText
											value={JSON.stringify(redisKeyDetails.value, null, 2)}
											isJson={typeof redisKeyDetails.value === "object"}
										/>
									</div>

									{/* Actions */}
									<div className="flex gap-2 pt-4 border-t">
										<Button variant="default" onClick={handleRedisEditKey}>
											Edit Key
										</Button>
										<Button
											variant="destructive"
											onClick={() => setShowDeleteDialog(true)}
										>
											Delete Key
										</Button>
										<Button
											variant="outline"
											onClick={() => setRedisSheetOpen(false)}
										>
											Close
										</Button>
									</div>
								</div>
							</>
						) : (
							<div className="flex items-center justify-center py-12 px-4 text-muted-foreground">
								Failed to load key details
							</div>
						)}
					</div>
				</SheetContent>
			</Sheet>

			{/* Delete Confirmation Dialog */}
			<AlertDialog open={showDeleteDialog} onOpenChange={setShowDeleteDialog}>
				<AlertDialogContent>
					<AlertDialogHeader>
						<AlertDialogTitle>Delete Redis Key?</AlertDialogTitle>
						<AlertDialogDescription>
							Are you sure you want to delete the key{" "}
							<span className="font-mono bg-muted px-2 py-0.5 rounded">
								{redisSelectedKey}
							</span>
							? This action cannot be undone.
						</AlertDialogDescription>
					</AlertDialogHeader>
					<AlertDialogFooter>
						<AlertDialogCancel>Cancel</AlertDialogCancel>
						<AlertDialogAction
							onClick={handleRedisDeleteKey}
							variant="destructive"
						>
							Delete
						</AlertDialogAction>
					</AlertDialogFooter>
				</AlertDialogContent>
			</AlertDialog>

			{/* Add/Edit Key Sheet */}
			<RedisKeySheet
				open={redisKeySheetOpen}
				onOpenChange={setRedisKeySheetOpen}
				mode={redisKeySheetMode}
				keyDetails={redisKeySheetMode === "edit" ? redisKeyDetails : null}
				onSave={handleRedisSaveKey}
				saving={savingRedisKey}
			/>
		</div>
	);

	const renderSchemaVisualizerContent = (tab: SchemaVisualizerTab) => (
		<div className="h-full">
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
		</div>
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
			default:
				return renderEmptyState();
		}
	};

	// Redis-specific layout without sidebar or tabs
	if (connection.type === "redis") {
		return (
			<div className="flex flex-col h-screen">
				<RedisContentHeader
					connection={connection}
					navigate={navigate}
					connectionStatus={connectionStatus}
					onReconnect={handleReconnect}
					onStatusChange={setConnectionStatus}
					onOpenSettings={openSettings}
				/>

				<div className="flex-1 p-4 min-w-0 overflow-auto">
					{renderRedisView()}
				</div>
			</div>
		);
	}

	return (
		<SidebarProvider>
			<Sidebar>
				<SidebarHeader
					className="border-b p-4 pt-10 select-none"
					onMouseDown={handleDragStart}
				>
					<div className="flex items-center justify-between gap-2">
						<div className="flex items-center gap-2 min-w-0 flex-1">
							<Table className="w-5 h-5 shrink-0" />
							<span className="font-semibold truncate">{connection.name}</span>
						</div>
						<div className="flex items-center gap-1 shrink-0">
							{connection.db_type !== "clickhouse" && (
								<Button
									variant="default"
									size="icon-sm"
									onClick={handleOpenSchemaVisualizer}
									title="Open Schema Visualizer"
									className="h-7 w-7"
								>
									<Graph className="w-4 h-4" />
								</Button>
							)}
							<Button
								variant="ghost"
								size="icon-sm"
								onClick={handleRefreshTables}
								disabled={refreshingTables || loadingSchemaOverview}
								title="Refresh tables list"
							>
								{refreshingTables || loadingSchemaOverview ? (
									<Spinner />
								) : (
									<ArrowsClockwise className="w-4 h-4" />
								)}
							</Button>
						</div>
					</div>
					<div className="text-xs text-muted-foreground mt-1">
						{connection.database}
					</div>
				</SidebarHeader>
				<SidebarContent className="p-2">
					<Tabs
						value={sidebarTab}
						onValueChange={(v) => setSidebarTab(v as "tables" | "queries")}
					>
						<TabsList className="w-full grid grid-cols-2">
							<TabsTrigger value="tables" className="flex items-center gap-2">
								<Table className="w-4 h-4" />
								Tables
							</TabsTrigger>
							<TabsTrigger value="queries" className="flex items-center gap-2">
								<Code className="w-4 h-4" />
								Queries
							</TabsTrigger>
						</TabsList>
						<TabsContent value="tables" className="mt-2">
							<div className="space-y-2 mb-2 px-2">
								<div className="relative">
									<MagnifyingGlass className="absolute left-2 top-1/2 -translate-y-1/2 w-3 h-3 text-muted-foreground" />
									<Input
										placeholder="Search tables..."
										value={tableSearchQuery}
										onChange={(e) => setTableSearchQuery(e.target.value)}
										className="pl-7 h-7 text-xs"
									/>
								</div>
								{tableSearchQuery && (
									<div className="text-xs text-muted-foreground">
										{filteredTables.length} of {tables.length} tables
									</div>
								)}
								{!tableSearchQuery && (
									<div className="text-xs text-muted-foreground">
										{tables.length} tables
									</div>
								)}
							</div>
							{Object.entries(tablesBySchema).map(([schema, schemaTables]) => (
								<SidebarGroup key={schema} className="p-0">
									<SidebarGroupLabel>{schema}</SidebarGroupLabel>
									<SidebarGroupContent>
										<SidebarMenu>
											{(schemaTables as DatabaseTable[]).map((table) => {
												const tableName = `${table.schema}.${table.name}`;
												const isExpanded = expandedTables.has(tableName);
												const isLoading =
													loadingColumns.has(tableName) ||
													(loadingSchemaOverview &&
														isExpanded &&
														!tableColumns[tableName]);
												const cols = tableColumns[tableName] || [];

												return (
													<ContextMenu key={tableName}>
														<ContextMenuTrigger>
															<Collapsible open={isExpanded}>
																<SidebarMenuItem>
																	<SidebarMenuButton
																		render={<div />}
																		className="w-full group-hover/menu-item:bg-sidebar-accent group-hover/menu-item:text-sidebar-accent-foreground cursor-pointer"
																		onClick={() => {
																			handleOpenTableData(tableName);
																		}}
																	>
																		<CollapsibleTrigger
																			onClick={(e) => {
																				e.stopPropagation();
																				handleToggleTableExpand(tableName);
																			}}
																			className="flex items-center justify-center p-1 rounded hover:bg-sidebar-border"
																		>
																			<CaretRight
																				className={`w-3 h-3 transition-transform ${
																					isExpanded ? "rotate-90" : ""
																				}`}
																			/>
																		</CollapsibleTrigger>
																		<Table className="w-3 h-3" />
																		<span className="truncate text-xs">
																			{table.name}
																		</span>
																		{table.type === "view" && (
																			<Badge
																				variant="secondary"
																				className="ml-auto text-xs"
																			>
																				View
																			</Badge>
																		)}
																	</SidebarMenuButton>
																	<DropdownMenu>
																		<DropdownMenuTrigger
																			render={
																				<button
																					type="button"
																					className="absolute right-1 top-1/2 -translate-y-1/2 p-1 rounded opacity-0 group-hover/menu-item:opacity-100 hover:bg-sidebar-border"
																					onClick={(e) => e.stopPropagation()}
																				/>
																			}
																		>
																			<DotsThreeVertical className="w-3 h-3" />
																		</DropdownMenuTrigger>
																		<DropdownMenuContent align="end">
																			<DropdownMenuItem
																				onClick={() => {
																					handleOpenTableData(tableName);
																				}}
																			>
																				<Table className="w-4 h-4" />
																				View Data
																			</DropdownMenuItem>
																			<DropdownMenuItem
																				onClick={() =>
																					handleRunQueryForTable(tableName)
																				}
																			>
																				<Code className="w-4 h-4" />
																				Run Query
																			</DropdownMenuItem>
																			<DropdownMenuItem
																				onClick={() =>
																					handleOpenTableStructure(tableName)
																				}
																			>
																				<Columns className="w-4 h-4" />
																				View Structure
																			</DropdownMenuItem>
																		</DropdownMenuContent>
																	</DropdownMenu>
																</SidebarMenuItem>
																<CollapsibleContent>
																	<SidebarMenuSub>
																		{isLoading ? (
																			<SidebarMenuSubItem>
																				<SidebarMenuSubButton>
																					<Spinner className="w-3 h-3" />
																					<span className="text-muted-foreground">
																						Loading...
																					</span>
																				</SidebarMenuSubButton>
																			</SidebarMenuSubItem>
																		) : cols.length > 0 ? (
																			cols.map((col) => (
																				<SidebarMenuSubItem key={col.name}>
																					<SidebarMenuSubButton
																						className="group/col-item"
																						onClick={() => {
																							// If there's an active query tab, insert column name
																							if (
																								activeTab &&
																								activeTab.type === "query"
																							) {
																								const queryTab =
																									activeTab as QueryTab;
																								const query = queryTab.query;
																								const needsSpace =
																									query.length > 0 &&
																									!query.endsWith(" ") &&
																									!query.endsWith("\n") &&
																									!query.endsWith("\t");
																								handleQueryChange(
																									query +
																										(needsSpace ? " " : "") +
																										col.name,
																								);
																							}
																						}}
																					>
																						<span className="font-mono text-xs truncate">
																							{col.name}
																						</span>
																						<span className="text-muted-foreground group-hover/col-item:text-sidebar-accent-foreground text-xs ml-auto truncate max-w-[80px]">
																							{col.type}
																						</span>
																						{col.primary_key && (
																							<Badge
																								variant="outline"
																								className="text-[10px] px-1 py-0 ml-1"
																							>
																								PK
																							</Badge>
																						)}
																					</SidebarMenuSubButton>
																				</SidebarMenuSubItem>
																			))
																		) : (
																			<SidebarMenuSubItem>
																				<SidebarMenuSubButton>
																					<span className="text-muted-foreground text-xs">
																						No columns
																					</span>
																				</SidebarMenuSubButton>
																			</SidebarMenuSubItem>
																		)}
																	</SidebarMenuSub>
																</CollapsibleContent>
															</Collapsible>
														</ContextMenuTrigger>
														<ContextMenuContent>
															<ContextMenuItem
																onClick={() => {
																	handleOpenTableData(tableName);
																}}
															>
																<Table className="w-4 h-4" />
																View Data
															</ContextMenuItem>
															<ContextMenuItem
																onClick={() =>
																	handleRunQueryForTable(tableName)
																}
															>
																<Code className="w-4 h-4" />
																Run Query
															</ContextMenuItem>
															<ContextMenuItem
																onClick={() =>
																	handleOpenTableStructure(tableName)
																}
															>
																<Columns className="w-4 h-4" />
																View Structure
															</ContextMenuItem>
														</ContextMenuContent>
													</ContextMenu>
												);
											})}
										</SidebarMenu>
									</SidebarGroupContent>
								</SidebarGroup>
							))}
						</TabsContent>
						<TabsContent value="queries" className="mt-2">
							<SidebarGroup>
								<SidebarGroupLabel>Saved Queries</SidebarGroupLabel>
								<SidebarGroupContent>
									{loadingQueries ? (
										<div className="flex items-center justify-center py-4">
											<Spinner />
										</div>
									) : savedQueries.length === 0 ? (
										<p className="text-xs text-muted-foreground px-2 py-4 text-center">
											No saved queries yet
										</p>
									) : (
										<SidebarMenu>
											{savedQueries.map((query) => (
												<ContextMenu key={query.id}>
													<ContextMenuTrigger>
														<SidebarMenuItem className="group/query">
															<SidebarMenuButton
																onClick={() => handleLoadQuery(query)}
																className="pr-8"
															>
																<Code className="w-4 h-4" />
																<span className="truncate flex-1">
																	{query.name}
																</span>
															</SidebarMenuButton>
															<DropdownMenu>
																<DropdownMenuTrigger
																	render={
																		<button
																			type="button"
																			className="absolute right-1 top-1/2 -translate-y-1/2 p-1 rounded opacity-0 group-hover/query:opacity-100 hover:bg-sidebar-accent"
																			onClick={(e) => e.stopPropagation()}
																		/>
																	}
																>
																	<DotsThreeVertical className="w-3 h-3" />
																</DropdownMenuTrigger>
																<DropdownMenuContent align="end">
																	<DropdownMenuItem
																		onClick={() => handleDeleteQuery(query)}
																		variant="destructive"
																	>
																		Delete
																	</DropdownMenuItem>
																</DropdownMenuContent>
															</DropdownMenu>
														</SidebarMenuItem>
													</ContextMenuTrigger>
													<ContextMenuContent>
														<ContextMenuItem
															onClick={() => handleDeleteQuery(query)}
															variant="destructive"
														>
															Delete
														</ContextMenuItem>
													</ContextMenuContent>
												</ContextMenu>
											))}
										</SidebarMenu>
									)}
								</SidebarGroupContent>
							</SidebarGroup>
						</TabsContent>
					</Tabs>
				</SidebarContent>
			</Sidebar>

			<SidebarInset className="min-w-0 flex flex-col h-screen">
				<ContentHeader
					connection={connection}
					navigate={navigate}
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

				<div className="flex-1 p-4 min-w-0 overflow-auto">
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
							| "clickhouse"
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
							| "clickhouse"
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
			{connection.type !== "redis" && (
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
					onSwitchSidebarTab={setSidebarTab}
					onOpenSettings={openSettings}
					connectionType={connection.type}
				/>
			)}
		</SidebarProvider>
	);
}
