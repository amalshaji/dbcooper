import { lazy, Suspense, useState, useMemo, useCallback } from "react";
import { useParams, useNavigate } from "react-router-dom";
import {
	type Tab,
	type FunctionDefinitionTab,
	type TableDataTab,
	type TableStructureTab,
	type QueryTab,
	type SchemaVisualizerTab,
} from "@/types/tabTypes";
import { api, type TableInfo } from "@/lib/tauri";
import { toast } from "sonner";
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
import { Table, Code, ClockCounterClockwise } from "@phosphor-icons/react";
import { Spinner } from "@/components/ui/spinner";
import { TabBar } from "@/components/TabBar";
import { useContextualSqlGeneration } from "@/hooks/useContextualSqlGeneration";
import { useQueryAiGeneration } from "@/hooks/useQueryAiGeneration";
import { useConnectionLifecycle } from "@/hooks/connection-details/useConnectionLifecycle";
import { useConnectionQueryRecords } from "@/hooks/connection-details/useConnectionQueryRecords";
import { useConnectionTabActions } from "@/hooks/connection-details/useConnectionTabActions";
import { useQueryWorkspaceController } from "@/hooks/connection-details/useQueryWorkspaceController";
import { useTableDataController } from "@/hooks/connection-details/useTableDataController";
import { useConnectionShortcuts } from "@/hooks/connection-details/useConnectionShortcuts";
import {
	ConnectionHeader,
	RedisConnectionHeader,
} from "@/components/connection-details/ConnectionHeaders";
import {
	ConnectionOpeningScreen,
	DatabaseIcon,
} from "@/components/connection-details/ConnectionOpeningScreen";
import { FunctionDefinitionView } from "@/components/connection-details/FunctionDefinitionView";
import { ObjectExplorer } from "@/components/connection-details/ObjectExplorer";
import { ConnectionWelcome } from "@/components/connection-details/ConnectionWelcome";
import { DisconnectedScreen } from "@/components/connection-details/DisconnectedScreen";
import { TableStructureView } from "@/components/connection-details/TableStructureView";
import { QueryWorkspace } from "@/components/connection-details/QueryWorkspace";
import { TableDataWorkspace } from "@/components/connection-details/TableDataWorkspace";
import { RedisWorkspace } from "@/components/connection-details/RedisWorkspace";
import {
	ConnectionSidebarHeader,
	QueryHistoryPanel,
	SavedQueriesPanel,
} from "@/components/connection-details/ConnectionSidebarPanels";
import { CommandPalette } from "@/components/CommandPalette";
import { useSettings } from "@/contexts/SettingsContext";
import { useTheme } from "@/contexts/ThemeContext";
import { getCreateTableDbType } from "@/lib/databaseCatalog";
import {
	applyTabPatch,
	type DispatchTabPatch,
	type UpdateTab,
} from "@/lib/connection-details/tabState";

const SchemaVisualizer = lazy(() =>
	import("@/components/SchemaVisualizer").then((module) => ({
		default: module.SchemaVisualizer,
	})),
);

export function ConnectionDetails() {
	const { uuid } = useParams<{ uuid: string }>();
	const navigate = useNavigate();
	const { openSettings } = useSettings();
	const { toggleTheme } = useTheme();
	const [sidebarTab, setSidebarTab] = useState<
		"objects" | "queries" | "history"
	>("objects");
	const [expandedTables, setExpandedTables] = useState<Set<string>>(new Set());
	const [tabs, setTabs] = useState<Tab[]>([]);
	const [activeTabId, setActiveTabId] = useState<string | null>(null);
	const lifecycle = useConnectionLifecycle({ uuid, navigate });
	const queryRecords = useConnectionQueryRecords({
		uuid,
		activePanel: sidebarTab,
	});
	const connection = lifecycle.connection.value;
	const tables = lifecycle.schema.tables;
	const tableColumns = lifecycle.schema.tableColumns;
	const schemaOverview = lifecycle.schema.overview;

	// AI generation
	const {
		generateDraft,
		cancelGeneration,
		isConfigured: aiConfigured,
	} = useContextualSqlGeneration({
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

	// Command palette state
	const [commandPaletteOpen, setCommandPaletteOpen] = useState(false);

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

	const patchTab = useCallback<DispatchTabPatch>((patch) => {
		setTabs((previous) => applyTabPatch(previous, patch));
	}, []);
	const updateTableDataTab = useCallback<UpdateTab<TableDataTab>>(
		(tabId, changes) => patchTab({ type: "table-data", tabId, changes }),
		[patchTab],
	);
	const updateQueryTab = useCallback<UpdateTab<QueryTab>>(
		(tabId, changes) => patchTab({ type: "query", tabId, changes }),
		[patchTab],
	);
	const tableDataController = useTableDataController({
		uuid,
		connection,
		activeTab,
		updateTableDataTab,
	});
	const {
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
	} = useConnectionTabActions({
		uuid,
		tabs,
		setTabs,
		activeTabId,
		setActiveTabId,
		schemaOverview,
		patchTab,
		fetchTableData: tableDataController.fetchTableData,
		cancelTabGeneration,
	});
	const queryController = useQueryWorkspaceController({
		uuid,
		connection,
		activeTab,
		updateQueryTab,
		onSavedQueryCreated: queryRecords.savedQueries.add,
		onSavedQueryUpdated: queryRecords.savedQueries.replace,
		onSavedQueryDeleted: queryRecords.savedQueries.remove,
		recordHistory: queryRecords.history.record,
		handleOpenQuery,
	});
	const handleClearFilter = useCallback(() => {
		if (activeTab?.type === "table-data") {
			tableDataController.commands.clearFilter();
		} else if (activeTab?.type === "query") {
			queryController.commands.clearFilter();
		}
	}, [activeTab, queryController.commands, tableDataController.commands]);
	const { handleToggleSidebar } = useConnectionShortcuts({
		activeTab,
		tabsLength: tabs.length,
		connection,
		setSidebarTab,
		navigate,
		handleNewQuery,
		handleNextTab,
		handlePreviousTab,
		handleSaveQuery: queryController.commands.openSaveDialog,
		handleRunQuery: queryController.commands.runQuery,
		handleRefreshTableData: tableDataController.commands.refresh,
		handleExportCSV: queryController.commands.exportCsv,
		handleClearFilter,
		handleOpenSchemaVisualizer,
	});

	const handleTableCreated = useCallback(
		(table: TableInfo) => {
			const fullTableName = `${table.schema}.${table.name}`;
			toast.success(`Created ${fullTableName}`);
			handleOpenTableData(fullTableName);
			void lifecycle.commands.loadSchema();
		},
		[lifecycle.commands, handleOpenTableData],
	);

	const handleToggleTableExpand = (tableName: string) => {
		const newExpanded = new Set(expandedTables);

		if (newExpanded.has(tableName)) {
			newExpanded.delete(tableName);
		} else {
			newExpanded.add(tableName);
		}
		setExpandedTables(newExpanded);
	};

	if (lifecycle.opening.phase !== "complete" || connection === null) {
		return (
			<ConnectionOpeningScreen
				connection={connection}
				loadingPhase={lifecycle.opening.phase}
				connectionStatus={lifecycle.connection.status}
				duckDbHelperProgress={lifecycle.opening.duckDbHelperProgress}
			/>
		);
	}

	const renderTableDataContent = (tab: TableDataTab) => (
		<TableDataWorkspace
			tab={tab}
			connection={connection}
			controller={tableDataController.workspace}
			onOpenTableDataWithFilter={handleOpenTableDataWithFilter}
		/>
	);

	const renderTableStructureContent = (tab: TableStructureTab) => (
		<TableStructureView tab={tab} />
	);

	const renderQueryContent = (tab: QueryTab) => (
		<QueryWorkspace
			tab={tab}
			connection={connection}
			tables={tables}
			tableColumns={tableColumns}
			controller={queryController.workspace}
			getEditorAiProps={getEditorAiProps}
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
					loading={lifecycle.schema.loading}
					onRefresh={lifecycle.commands.loadSchema}
					onTableClick={handleOpenTableData}
					tableFilter={tab.tableFilter}
					onTableFilterChange={(filter) => {
						patchTab({
							type: "schema-visualizer",
							tabId: tab.id,
							changes: { tableFilter: filter },
						});
					}}
					selectedTables={tab.selectedTables}
					onSelectedTablesChange={(tables) => {
						patchTab({
							type: "schema-visualizer",
							tabId: tab.id,
							changes: { selectedTables: tables },
						});
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
				return renderTableDataContent(activeTab);
			case "table-structure":
				return renderTableStructureContent(activeTab);
			case "query":
				return renderQueryContent(activeTab);
			case "schema-visualizer":
				return renderSchemaVisualizerContent(activeTab);
			case "function-definition":
				return renderFunctionDefinitionContent(activeTab);
			default:
				return renderEmptyState();
		}
	};

	// Initial connect failed: show a dedicated error screen instead of the
	// empty workspace shell. A mid-session drop (after connecting at least
	// once) keeps the workspace and reconnects via the header status badge.
	const showDisconnectedScreen =
		lifecycle.connection.status === "disconnected" &&
		!lifecycle.connection.hasEverConnected;

	if (showDisconnectedScreen) {
		return (
			<DisconnectedScreen
				connectionName={connection.name}
				databaseIcon={<DatabaseIcon connection={connection} />}
				error={lifecycle.connection.error}
				onReconnect={lifecycle.commands.reconnect}
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
					connectionStatus={lifecycle.connection.status}
					onReconnect={lifecycle.commands.reconnect}
					onStatusChange={lifecycle.commands.recordConnectionStatus}
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
					refreshing={lifecycle.schema.refreshing || lifecycle.schema.loading}
					onOpenSchemaVisualizer={handleOpenSchemaVisualizer}
					onRefresh={lifecycle.commands.refreshSchema}
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
								loading={lifecycle.schema.loading}
								expandedTables={expandedTables}
								tableColumns={tableColumns}
								onToggleTableExpand={handleToggleTableExpand}
								onOpenTableData={handleOpenTableData}
								onRunQueryForTable={handleRunQueryForTable}
								onOpenTableStructure={handleOpenTableStructure}
								onOpenFunctionDefinition={handleOpenFunctionDefinition}
								activeQueryTab={activeTab?.type === "query" ? activeTab : null}
								onInsertQueryText={queryController.insertQueryText}
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
							loading={queryRecords.savedQueries.loading}
							queries={queryRecords.savedQueries.items}
							onLoad={queryController.savedQueries.load}
							onDelete={queryController.savedQueries.requestDelete}
						/>
						<QueryHistoryPanel
							loading={queryRecords.history.loading}
							history={queryRecords.history.items}
							onOpen={handleOpenQuery}
							onClear={queryRecords.history.clear}
						/>
					</Tabs>
				</SidebarContent>
			</Sidebar>

			<SidebarInset className="workspace-canvas flex h-screen min-w-0 flex-col">
				<ConnectionHeader
					connection={connection}
					onClose={() => navigate("/")}
					connectionStatus={lifecycle.connection.status}
					onReconnect={lifecycle.commands.reconnect}
					onStatusChange={lifecycle.commands.recordConnectionStatus}
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
				open={queryController.savedQueries.deleteDialogOpen}
				onOpenChange={(open) => {
					if (!open) queryController.savedQueries.closeDeleteDialog();
				}}
			>
				<AlertDialogContent>
					<AlertDialogHeader>
						<AlertDialogTitle>Delete Saved Query?</AlertDialogTitle>
						<AlertDialogDescription>
							Are you sure you want to delete the saved query{" "}
							<span className="font-semibold">
								"{queryController.savedQueries.queryToDelete?.name}"
							</span>
							? This action cannot be undone.
						</AlertDialogDescription>
					</AlertDialogHeader>
					<AlertDialogFooter>
						<AlertDialogCancel>Cancel</AlertDialogCancel>
						<AlertDialogAction
							onClick={queryController.savedQueries.confirmDelete}
							variant="destructive"
						>
							Delete
						</AlertDialogAction>
					</AlertDialogFooter>
				</AlertDialogContent>
			</AlertDialog>

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
				onRunQuery={queryController.commands.runQuery}
				onSaveQuery={queryController.commands.openSaveDialog}
				onRefresh={() => {
					if (activeTab?.type === "query") {
						queryController.commands.runQuery();
					} else if (activeTab?.type === "table-data") {
						tableDataController.commands.refresh();
					}
				}}
				onExportCSV={queryController.commands.exportCsv}
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
