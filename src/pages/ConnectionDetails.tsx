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
import { Spinner } from "@/components/ui/spinner";
import { TabBar } from "@/components/TabBar";
import { useContextualSqlGeneration } from "@/hooks/useContextualSqlGeneration";
import { useQueryAiGeneration } from "@/hooks/useQueryAiGeneration";
import { useConnectionLifecycle } from "@/hooks/connection-details/useConnectionLifecycle";
import { useConnectionTabActions } from "@/hooks/connection-details/useConnectionTabActions";
import { useQueryWorkspaceController } from "@/hooks/connection-details/useQueryWorkspaceController";
import { useTableDataController } from "@/hooks/connection-details/useTableDataController";
import { useConnectionShortcuts } from "@/hooks/connection-details/useConnectionShortcuts";
import { RowEditSheet } from "@/components/RowEditSheet";
import { RowInsertSheet } from "@/components/RowInsertSheet";
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
import { useSettings } from "@/contexts/SettingsContext";
import { useTheme } from "@/contexts/ThemeContext";
import { getCreateTableDbType } from "@/lib/databaseCatalog";
import {
	captureSavedViewState,
	hasUnappliedFilterDraft,
} from "@/lib/savedViews";
import { supportsStructuredRowMutations } from "@/lib/databaseCapabilities";
import {
	applyTabPatch,
	type DispatchTabPatch,
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
	const {
		connection,
		tables,
		setTables,
		loadingPhase,
		duckDbHelperProgress,
		refreshingTables,
		setRefreshingTables,
		savedQueries,
		setSavedQueries,
		loadingQueries,
		queryHistory,
		setQueryHistory,
		loadingHistory,
		tableColumns,
		setTableColumns,
		schemaOverview,
		setSchemaOverview,
		loadingSchemaOverview,
		connectionStatus,
		setConnectionStatus,
		connectionError,
		hasEverConnected,
		markConnected,
		markDisconnected,
		fetchSchemaOverviewData,
		recordHistory,
	} = useConnectionLifecycle({ uuid, navigate, sidebarTab, setTabs });

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
	const updateTableDataTab = useCallback(
		(tabId: string, changes: Partial<Omit<TableDataTab, "id" | "type">>) =>
			patchTab({ type: "table-data", tabId, changes }),
		[patchTab],
	);
	const updateQueryTab = useCallback(
		(tabId: string, changes: Partial<Omit<QueryTab, "id" | "type">>) =>
			patchTab({ type: "query", tabId, changes }),
		[patchTab],
	);
	const {
		fetchTableData,
		handleTableFilterStateChange,
		handleApplyFilter,
		clearTableFilter,
		handleCellFilter,
		handleApplySavedView,
		handleRefreshTableData,
		handlePageChange,
		handleSortChange,
		rowEditSheetOpen,
		setRowEditSheetOpen,
		editingRow,
		setEditingRow,
		savingRow,
		deletingRow,
		highlightedTableRow,
		pendingInlineEditsByTab,
		savingInlineEdits,
		rowInsertSheetOpen,
		setRowInsertSheetOpen,
		insertingRow,
		handleRowClick,
		handleSaveRow,
		handleInlineCellSave,
		handleSaveInlineChanges,
		handleDiscardInlineChanges,
		handleDeleteRow,
		handleInsertRow,
	} = useTableDataController({
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
		fetchTableData,
		cancelTabGeneration,
	});
	const queryController = useQueryWorkspaceController({
		uuid,
		connection,
		activeTab,
		updateQueryTab,
		setSavedQueries,
		recordHistory,
		handleOpenQuery,
	});
	const handleClearFilter = useCallback(() => {
		if (activeTab?.type === "table-data") {
			clearTableFilter();
		} else if (activeTab?.type === "query") {
			queryController.commands.clearFilter();
		}
	}, [activeTab, clearTableFilter, queryController.commands]);
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
		handleRefreshTableData,
		handleExportCSV: queryController.commands.exportCsv,
		handleClearFilter,
		handleOpenSchemaVisualizer,
	});

	const handleTableCreated = useCallback(
		(table: TableInfo) => {
			const fullTableName = `${table.schema}.${table.name}`;
			toast.success(`Created ${fullTableName}`);
			handleOpenTableData(fullTableName);
			void fetchSchemaOverviewData();
		},
		[fetchSchemaOverviewData, handleOpenTableData],
	);

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
									updateTableDataTab(tab.id, { savedViewId })
								}
								onApply={handleApplySavedView}
							/>
							<ColumnLayoutPopover
								columns={tab.columns.map((column) => column.name)}
								layout={tab.columnLayout}
								onChange={(columnLayout) =>
									updateTableDataTab(tab.id, { columnLayout })
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
							updateTableDataTab(tab.id, { columnLayout })
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
					loading={loadingSchemaOverview}
					onRefresh={fetchSchemaOverviewData}
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
							loading={loadingQueries}
							queries={savedQueries}
							onLoad={queryController.savedQueries.load}
							onDelete={queryController.savedQueries.requestDelete}
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
				open={queryController.savedQueries.deleteDialogOpen}
				onOpenChange={queryController.savedQueries.setDeleteDialogOpen}
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

			{/* Row Edit Sheet */}
			{activeTab && activeTab.type === "table-data" && connection && (
				<RowEditSheet
					open={rowEditSheetOpen}
					onOpenChange={(open) => {
						setRowEditSheetOpen(open);
						if (!open) setEditingRow(null);
					}}
					tableName={activeTab.tableName}
					row={editingRow}
					columns={activeTab.columns}
					dbType={connection.type}
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
					tableName={activeTab.tableName}
					columns={activeTab.columns}
					dbType={connection.type}
					onInsert={handleInsertRow}
					inserting={insertingRow}
				/>
			)}

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
						handleRefreshTableData();
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
