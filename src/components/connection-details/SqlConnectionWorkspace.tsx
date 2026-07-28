import { lazy, Suspense, useCallback, useMemo, useState } from "react";
import { ClockCounterClockwise, Code, Table } from "@phosphor-icons/react";
import { toast } from "sonner";
import { CommandPalette } from "@/components/CommandPalette";
import { TabBar } from "@/components/TabBar";
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
	SidebarInset,
	SidebarProvider,
} from "@/components/ui/sidebar";
import { Spinner } from "@/components/ui/spinner";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useSettings } from "@/contexts/SettingsContext";
import { useTheme } from "@/contexts/ThemeContext";
import type { ConnectionLifecycleController } from "@/hooks/connection-details/useConnectionLifecycle";
import { useConnectionQueryRecords } from "@/hooks/connection-details/useConnectionQueryRecords";
import { useConnectionShortcuts } from "@/hooks/connection-details/useConnectionShortcuts";
import { useConnectionTabActions } from "@/hooks/connection-details/useConnectionTabActions";
import { useQueryWorkspaceController } from "@/hooks/connection-details/useQueryWorkspaceController";
import { useTableDataController } from "@/hooks/connection-details/useTableDataController";
import { useContextualSqlGeneration } from "@/hooks/useContextualSqlGeneration";
import { useQueryAiGeneration } from "@/hooks/useQueryAiGeneration";
import {
	applyTabPatch,
	type DispatchTabPatch,
	type UpdateTab,
} from "@/lib/connection-details/tabState";
import { getCreateTableDbType } from "@/lib/databaseCatalog";
import { api, type TableInfo } from "@/lib/tauri";
import type { SqlConnection } from "@/types/connection";
import type {
	QueryTab,
	SchemaVisualizerTab,
	Tab,
	TableDataTab,
} from "@/types/tabTypes";
import { ConnectionHeader } from "./ConnectionHeaders";
import {
	ConnectionSidebarHeader,
	QueryHistoryPanel,
	SavedQueriesPanel,
} from "./ConnectionSidebarPanels";
import { ConnectionWelcome } from "./ConnectionWelcome";
import { FunctionDefinitionView } from "./FunctionDefinitionView";
import { ObjectExplorer } from "./ObjectExplorer";
import { QueryWorkspace } from "./QueryWorkspace";
import { TableDataWorkspace } from "./TableDataWorkspace";
import { TableStructureView } from "./TableStructureView";

const SchemaVisualizer = lazy(() =>
	import("@/components/SchemaVisualizer").then((module) => ({
		default: module.SchemaVisualizer,
	})),
);

interface SqlConnectionWorkspaceProps {
	connection: SqlConnection;
	lifecycle: ConnectionLifecycleController;
	onClose: () => void;
}

export function SqlConnectionWorkspace({
	connection,
	lifecycle,
	onClose,
}: SqlConnectionWorkspaceProps) {
	const { openSettings } = useSettings();
	const { toggleTheme } = useTheme();
	const [sidebarTab, setSidebarTab] = useState<
		"objects" | "queries" | "history"
	>("objects");
	const [expandedTables, setExpandedTables] = useState<Set<string>>(new Set());
	const [tabs, setTabs] = useState<Tab[]>([]);
	const [activeTabId, setActiveTabId] = useState<string | null>(null);
	const [commandPaletteOpen, setCommandPaletteOpen] = useState(false);
	const queryRecords = useConnectionQueryRecords({
		uuid: connection.uuid,
		activePanel: sidebarTab,
	});
	const tables = lifecycle.schema.tables;
	const tableColumns = lifecycle.schema.tableColumns;
	const schemaOverview = lifecycle.schema.overview;

	const {
		generateDraft,
		cancelGeneration,
		isConfigured: aiConfigured,
	} = useContextualSqlGeneration({
		dbType: connection.db_type,
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

	const activeTab = useMemo(
		() => tabs.find((tab) => tab.id === activeTabId) ?? null,
		[tabs, activeTabId],
	);
	const activeQueryTab = activeTab?.type === "query" ? activeTab : null;
	const activeTableDataTab =
		activeTab?.type === "table-data" ? activeTab : null;
	const totalObjectCount =
		tables.length + (schemaOverview?.functions.length ?? 0);
	const objectSchemaCount = useMemo(() => {
		const schemas = new Set(tables.map((table) => table.schema));
		for (const definition of schemaOverview?.functions ?? []) {
			schemas.add(definition.schema);
		}
		return schemas.size;
	}, [tables, schemaOverview]);
	const createTableDbType = getCreateTableDbType(connection.db_type);

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
		connection,
		activeTab: activeTableDataTab,
		updateTableDataTab,
	});
	const tabActions = useConnectionTabActions({
		uuid: connection.uuid,
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
		connection,
		activeTab: activeQueryTab,
		updateQueryTab,
		onSavedQueryCreated: queryRecords.savedQueries.add,
		onSavedQueryUpdated: queryRecords.savedQueries.replace,
		onSavedQueryDeleted: queryRecords.savedQueries.remove,
		recordHistory: queryRecords.history.record,
		handleOpenQuery: tabActions.handleOpenQuery,
	});
	const handleClearFilter = useCallback(() => {
		if (activeTableDataTab) {
			tableDataController.commands.clearFilter();
		} else if (activeQueryTab) {
			queryController.commands.clearFilter();
		}
	}, [
		activeQueryTab,
		activeTableDataTab,
		queryController.commands,
		tableDataController.commands,
	]);
	const { handleToggleSidebar } = useConnectionShortcuts({
		activeTab,
		tabsLength: tabs.length,
		connection,
		setSidebarTab,
		navigate: onClose,
		handleNewQuery: tabActions.handleNewQuery,
		handleNextTab: tabActions.handleNextTab,
		handlePreviousTab: tabActions.handlePreviousTab,
		handleSaveQuery: queryController.commands.openSaveDialog,
		handleRunQuery: queryController.commands.runQuery,
		handleRefreshTableData: tableDataController.commands.refresh,
		handleExportCSV: queryController.commands.exportCsv,
		handleClearFilter,
		handleOpenSchemaVisualizer: tabActions.handleOpenSchemaVisualizer,
	});

	const handleTableCreated = useCallback(
		(table: TableInfo) => {
			const fullTableName = `${table.schema}.${table.name}`;
			toast.success(`Created ${fullTableName}`);
			tabActions.handleOpenTableData(fullTableName);
			void lifecycle.commands.loadSchema();
		},
		[lifecycle.commands, tabActions],
	);
	const handleToggleTableExpand = (tableName: string) => {
		setExpandedTables((current) => {
			const next = new Set(current);
			if (next.has(tableName)) next.delete(tableName);
			else next.add(tableName);
			return next;
		});
	};

	const renderEmptyState = () => (
		<ConnectionWelcome
			connection={connection}
			totalObjectCount={totalObjectCount}
			objectSchemaCount={objectSchemaCount}
			onNewQuery={tabActions.handleNewQuery}
			onOpenSchemaVisualizer={tabActions.handleOpenSchemaVisualizer}
		/>
	);
	const renderSchemaVisualizer = (tab: SchemaVisualizerTab) => (
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
					onTableClick={tabActions.handleOpenTableData}
					tableFilter={tab.tableFilter}
					onTableFilterChange={(tableFilter) =>
						patchTab({
							type: "schema-visualizer",
							tabId: tab.id,
							changes: { tableFilter },
						})
					}
					selectedTables={tab.selectedTables}
					onSelectedTablesChange={(selectedTables) =>
						patchTab({
							type: "schema-visualizer",
							tabId: tab.id,
							changes: { selectedTables },
						})
					}
				/>
			</Suspense>
		</div>
	);
	const renderActiveTab = () => {
		if (!activeTab) return renderEmptyState();
		switch (activeTab.type) {
			case "table-data":
				return (
					<TableDataWorkspace
						tab={activeTab}
						connection={connection}
						controller={tableDataController.workspace}
						onOpenTableDataWithFilter={tabActions.handleOpenTableDataWithFilter}
					/>
				);
			case "table-structure":
				return <TableStructureView tab={activeTab} />;
			case "query":
				return (
					<QueryWorkspace
						tab={activeTab}
						connection={connection}
						tables={tables}
						tableColumns={tableColumns}
						controller={queryController.workspace}
						getEditorAiProps={getEditorAiProps}
					/>
				);
			case "schema-visualizer":
				return renderSchemaVisualizer(activeTab);
			case "function-definition":
				return <FunctionDefinitionView tab={activeTab} />;
			default:
				return renderEmptyState();
		}
	};

	return (
		<SidebarProvider>
			<Sidebar>
				<ConnectionSidebarHeader
					connection={connection}
					refreshing={lifecycle.schema.refreshing || lifecycle.schema.loading}
					onOpenSchemaVisualizer={tabActions.handleOpenSchemaVisualizer}
					onRefresh={lifecycle.commands.refreshSchema}
				/>
				<SidebarContent className="overflow-hidden p-2">
					<Tabs
						value={sidebarTab}
						onValueChange={(value) =>
							setSidebarTab(value as "objects" | "queries" | "history")
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
								onOpenTableData={tabActions.handleOpenTableData}
								onRunQueryForTable={tabActions.handleRunQueryForTable}
								onOpenTableStructure={tabActions.handleOpenTableStructure}
								onOpenFunctionDefinition={
									tabActions.handleOpenFunctionDefinition
								}
								activeQueryTab={activeQueryTab}
								onInsertQueryText={queryController.insertQueryText}
								createTable={
									createTableDbType
										? {
												dbType: createTableDbType,
												defaultSchema: connection.database,
												onPreview: (request) =>
													api.pool.previewCreateTable(connection.uuid, request),
												onCreate: (request) =>
													api.pool.createTable(connection.uuid, request),
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
							onOpen={tabActions.handleOpenQuery}
							onClear={queryRecords.history.clear}
						/>
					</Tabs>
				</SidebarContent>
			</Sidebar>

			<SidebarInset className="workspace-canvas flex h-screen min-w-0 flex-col">
				<ConnectionHeader
					connection={connection}
					onClose={onClose}
					connectionStatus={lifecycle.connection.status}
					onReconnect={lifecycle.commands.reconnect}
					onStatusChange={lifecycle.commands.recordConnectionStatus}
					onOpenSettings={openSettings}
				/>
				<TabBar
					tabs={tabs}
					activeTabId={activeTabId}
					onTabSelect={tabActions.handleTabSelect}
					onTabClose={tabActions.handleCloseTab}
					onNewQuery={tabActions.handleNewQuery}
				/>
				<div className="min-w-0 flex-1 overflow-auto p-3">
					{renderActiveTab()}
				</div>
			</SidebarInset>

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

			<CommandPalette
				open={commandPaletteOpen}
				onOpenChange={setCommandPaletteOpen}
				activeTab={activeTab}
				tabs={tabs}
				onNavigateBack={onClose}
				onToggleSidebar={handleToggleSidebar}
				onNewQuery={tabActions.handleNewQuery}
				onCloseTab={tabActions.handleCloseTab}
				onNextTab={tabActions.handleNextTab}
				onPreviousTab={tabActions.handlePreviousTab}
				onRunQuery={queryController.commands.runQuery}
				onSaveQuery={queryController.commands.openSaveDialog}
				onRefresh={() => {
					if (activeQueryTab) queryController.commands.runQuery();
					else if (activeTableDataTab) tableDataController.commands.refresh();
				}}
				onExportCSV={queryController.commands.exportCsv}
				onClearFilter={handleClearFilter}
				onOpenSchemaVisualizer={tabActions.handleOpenSchemaVisualizer}
				onOpenTableData={tabActions.handleOpenTableData}
				onOpenFunctionDefinition={tabActions.handleOpenFunctionDefinition}
				onSwitchSidebarTab={setSidebarTab}
				onOpenSettings={openSettings}
				onToggleTheme={toggleTheme}
				tables={tables}
				functions={schemaOverview?.functions ?? []}
				connectionType={connection.type}
			/>
		</SidebarProvider>
	);
}
