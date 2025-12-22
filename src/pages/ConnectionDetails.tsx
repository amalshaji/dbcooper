import { useEffect, useState, useMemo, useCallback } from "react";
import { useParams, useNavigate } from "react-router-dom";
import {
  type Tab,
  type TableDataTab,
  type TableStructureTab,
  type QueryTab,
  type TableColumn,
  type TableStructureData,
  type ForeignKeyInfo,
  createTableDataTab,
  createTableStructureTab,
  createQueryTab,
} from "@/types/tabTypes";
import type { DatabaseTable } from "@/types/table";
import type { SavedQuery } from "@/types/savedQuery";
import { api, type Connection } from "@/lib/tauri";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
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
  Table,
  ArrowLeft,
  ArrowRight,
  Code,
  DotsThreeVertical,
  FloppyDisk,
  ArrowsClockwise,
  Database,
  CaretRight,
  Columns,
} from "@phosphor-icons/react";
import { DataTable } from "@/components/DataTable";
import type { ColumnDef } from "@tanstack/react-table";
import { Spinner } from "@/components/ui/spinner";
import { SqlEditor } from "@/components/SqlEditor";
import { TabBar } from "@/components/TabBar";
import { useAIGeneration } from "@/hooks/useAIGeneration";

// Header component that uses useSidebar for conditional padding
function ContentHeader({ connection, navigate }: { connection: Connection; navigate: (path: string) => void }) {
  const { state } = useSidebar();
  const isCollapsed = state === "collapsed";

  return (
    <header
      data-tauri-drag-region
      className={`flex h-10 shrink-0 items-center gap-2 border-b px-4 bg-background ${isCollapsed ? 'pl-20' : ''}`}
    >
      <SidebarTrigger className="-ml-1" />
      <div className="flex items-center gap-2 flex-1">
        <Button
          variant="ghost"
          size="sm"
          onClick={() => navigate("/")}
          className="gap-2"
        >
          <ArrowLeft className="w-4 h-4" />
          Back
        </Button>
      </div>
      <div className="flex items-center gap-2">
        <Badge variant="secondary" className="capitalize">
          {connection.type}
        </Badge>
        <Badge variant={connection.ssl ? "default" : "secondary"}>
          SSL: {connection.ssl ? "Yes" : "No"}
        </Badge>
      </div>
    </header>
  );
}

export function ConnectionDetails() {
  const { uuid } = useParams<{ uuid: string }>();
  const navigate = useNavigate();
  const [connection, setConnection] = useState<Connection | null>(null);
  const [tables, setTables] = useState<DatabaseTable[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshingTables, setRefreshingTables] = useState(false);
  const [sidebarTab, setSidebarTab] = useState<"tables" | "queries">("tables");
  const [savedQueries, setSavedQueries] = useState<SavedQuery[]>([]);
  const [loadingQueries, setLoadingQueries] = useState(false);
  const [expandedTables, setExpandedTables] = useState<Set<string>>(new Set());
  const [tableColumns, setTableColumns] = useState<
    Record<string, TableColumn[]>
  >({});
  const [loadingColumns, setLoadingColumns] = useState<Set<string>>(new Set());

  // Tab state
  const [tabs, setTabs] = useState<Tab[]>([]);
  const [activeTabId, setActiveTabId] = useState<string | null>(null);

  // Save dialog state (for query tabs)
  const [saveQueryName, setSaveQueryName] = useState("");
  const [showSaveDialog, setShowSaveDialog] = useState(false);

  // AI generation
  const { generateSQL, generating, isConfigured: aiConfigured } = useAIGeneration();

  const activeTab = useMemo(
    () => tabs.find((t) => t.id === activeTabId) || null,
    [tabs, activeTabId]
  );

  useEffect(() => {
    const fetchConnection = async () => {
      if (!uuid) return;
      try {
        const data = await api.connections.getByUuid(uuid);
        setConnection(data);
      } catch (error) {
        console.error("Failed to fetch connection:", error);
        navigate("/");
      }
    };

    if (uuid) {
      fetchConnection();
    }
  }, [uuid, navigate]);

  useEffect(() => {
    const fetchTables = async () => {
      if (!connection) return;
      try {
        const data = await api.database.listTables(connection);
        setTables(data as DatabaseTable[]);
      } catch (error) {
        console.error("Failed to fetch tables:", error);
        setTables([]);
      } finally {
        setLoading(false);
      }
    };

    if (connection) {
      fetchTables();
    }
  }, [connection]);

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
        prev.map((t) => (t.id === tabId ? { ...t, ...updates } : t))
      );
    },
    []
  );

  const fetchTableData = useCallback(
    async (tab: TableDataTab) => {
      if (!connection) return;

      updateTab<TableDataTab>(tab.id, { loading: true });

      try {
        const [schema, tableName] = tab.tableName.split(".");
        const data = await api.database.getTableData(
          connection,
          schema,
          tableName,
          tab.currentPage,
          100,
          tab.filter || undefined
        );

        updateTab<TableDataTab>(tab.id, { data, loading: false });
      } catch (error) {
        console.error("Failed to fetch table data:", error);
        const errorMessage = error instanceof Error ? error.message : String(error);
        toast.error("Failed to load table data", {
          description: errorMessage,
        });
        updateTab<TableDataTab>(tab.id, { data: null, loading: false });
      }
    },
    [connection, updateTab]
  );

  const fetchTableStructure = useCallback(
    async (tab: TableStructureTab) => {
      if (!connection) return;

      updateTab<TableStructureTab>(tab.id, { loading: true });

      try {
        const [schema, tableName] = tab.tableName.split(".");
        const data = await api.database.getTableStructure(
          connection,
          schema,
          tableName
        );

        updateTab<TableStructureTab>(tab.id, { structure: data as TableStructureData, loading: false });
      } catch (error) {
        console.error("Failed to fetch table structure:", error);
        updateTab<TableStructureTab>(tab.id, { structure: null, loading: false });
      }
    },
    [connection, updateTab]
  );

  const fetchForeignKeys = useCallback(
    async (tab: TableDataTab) => {
      if (!connection) return;

      try {
        const [schema, tableName] = tab.tableName.split(".");
        const data = await api.database.getTableStructure(
          connection,
          schema,
          tableName
        );
        updateTab<TableDataTab>(tab.id, { foreignKeys: (data.foreign_keys as ForeignKeyInfo[]) || [] });
      } catch (error) {
        console.error("Failed to fetch foreign keys:", error);
      }
    },
    [connection, updateTab]
  );

  const handleOpenTableData = useCallback(
    (tableName: string) => {
      // Check if tab already exists
      const existingTab = tabs.find(
        (t) => t.type === "table-data" && (t as TableDataTab).tableName === tableName
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
    [tabs, fetchTableData, fetchForeignKeys]
  );

  const handleOpenTableDataWithFilter = useCallback(
    (tableName: string, filterColumn: string, filterValue: unknown) => {
      const filterStr = typeof filterValue === "string"
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
    [fetchTableData, fetchForeignKeys]
  );

  const handleOpenTableStructure = useCallback(
    (tableName: string) => {
      // Check if tab already exists
      const existingTab = tabs.find(
        (t) =>
          t.type === "table-structure" &&
          (t as TableStructureTab).tableName === tableName
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
    [tabs, fetchTableStructure]
  );

  const handleOpenQuery = useCallback(
    (query: string, savedQueryId: number | null = null, savedQueryName: string | null = null) => {
      // Check if saved query tab already exists
      if (savedQueryId) {
        const existingTab = tabs.find(
          (t) => t.type === "query" && (t as QueryTab).savedQueryId === savedQueryId
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
    [tabs]
  );

  const handleNewQuery = useCallback(() => {
    const newTab = createQueryTab("SELECT * FROM ");
    setTabs((prev) => [...prev, newTab]);
    setActiveTabId(newTab.id);
  }, []);

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
    [activeTabId]
  );

  const handleTabSelect = useCallback((tabId: string) => {
    setActiveTabId(tabId);
  }, []);

  const handleRefreshTables = async () => {
    if (!connection || refreshingTables) return;

    setRefreshingTables(true);
    try {
      const data = await api.database.listTables(connection);
      setTables(data as DatabaseTable[]);
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
    [activeTab, updateTab, fetchTableData]
  );

  const handleFilterInputChange = useCallback(
    (value: string) => {
      if (!activeTab || activeTab.type !== "table-data") return;
      updateTab<TableDataTab>(activeTab.id, { filterInput: value });
    },
    [activeTab, updateTab]
  );

  const handleApplyFilter = useCallback(() => {
    if (!activeTab || activeTab.type !== "table-data") return;
    const tab = activeTab as TableDataTab;
    updateTab<TableDataTab>(tab.id, { filter: tab.filterInput, currentPage: 1 });
    fetchTableData({ ...tab, filter: tab.filterInput, currentPage: 1 });
  }, [activeTab, updateTab, fetchTableData]);

  const handleClearFilter = useCallback(() => {
    if (!activeTab || activeTab.type !== "table-data") return;
    const tab = activeTab as TableDataTab;
    updateTab<TableDataTab>(tab.id, { filter: "", filterInput: "", currentPage: 1 });
    fetchTableData({ ...tab, filter: "", currentPage: 1 });
  }, [activeTab, updateTab, fetchTableData]);

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

    if (!tableColumns[tableName] && connection) {
      const [schema, table] = tableName.split(".");
      const newLoading = new Set(loadingColumns);
      newLoading.add(tableName);
      setLoadingColumns(newLoading);

      try {
        const data = await api.database.getTableStructure(
          connection,
          schema,
          table
        );
        setTableColumns((prev) => ({
          ...prev,
          [tableName]: (data.columns as TableColumn[]) || [],
        }));
      } catch (error) {
        console.error("Failed to fetch table columns:", error);
      } finally {
        setLoadingColumns((prev) => {
          const updated = new Set(prev);
          updated.delete(tableName);
          return updated;
        });
      }
    }
  };

  const handleRunQuery = useCallback(async () => {
    if (!activeTab || activeTab.type !== "query" || !connection) return;

    const tab = activeTab as QueryTab;
    if (!tab.query.trim()) return;

    updateTab<QueryTab>(tab.id, {
      executing: true,
      error: null,
      results: null,
      success: false,
      executionTime: null,
    });

    const startTime = performance.now();

    try {
      const result = await api.database.executeQuery(connection, tab.query);

      const endTime = performance.now();
      const executionTime = Math.round(endTime - startTime);

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
      const endTime = performance.now();
      const executionTime = Math.round(endTime - startTime);

      updateTab<QueryTab>(tab.id, {
        error: error instanceof Error ? error.message : "Failed to execute query",
        executionTime,
        executing: false,
      });
    }
  }, [activeTab, connection, updateTab]);

  const handleQueryChange = useCallback(
    (query: string) => {
      if (!activeTab || activeTab.type !== "query") return;
      updateTab<QueryTab>(activeTab.id, { query });
    },
    [activeTab, updateTab]
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
            q.id === tab.savedQueryId ? (updatedQuery as SavedQuery) : q
          )
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

  const handleDeleteQuery = async (queryId: number) => {
    try {
      await api.queries.delete(queryId);
      setSavedQueries(savedQueries.filter((q) => q.id !== queryId));
    } catch (error) {
      console.error("Failed to delete query:", error);
    }
  };

  // Memoized columns for table data
  const tableDataColumns = useMemo<ColumnDef<Record<string, unknown>>[]>(() => {
    if (!activeTab || activeTab.type !== "table-data") return [];
    const tab = activeTab as TableDataTab;
    if (!tab.data || tab.data.data.length === 0) return [];

    const schema = tab.tableName.split(".")[0];
    const firstRow = tab.data.data[0];
    return Object.keys(firstRow).map((key) => {
      const fkInfo = tab.foreignKeys.find((fk) => fk.column === key);

      return {
        accessorKey: key,
        header: () => (
          <span className="flex items-center gap-1">
            {key}
            {fkInfo && (
              <span className="text-[10px] text-muted-foreground">(FK)</span>
            )}
          </span>
        ),
        cell: ({ getValue }) => {
          const value = getValue();
          if (value === null)
            return <span className="text-muted-foreground italic">null</span>;

          const displayValue = typeof value === "object" ? JSON.stringify(value) : String(value);

          if (fkInfo && value !== null) {
            const refTable = `${schema}.${fkInfo.references_table}`;
            return (
              <span className="group/fk flex items-center gap-1">
                <span>{displayValue}</span>
                <button
                  type="button"
                  className="opacity-0 group-hover/fk:opacity-100 p-0.5 rounded hover:bg-muted transition-opacity"
                  onClick={(e) => {
                    e.stopPropagation();
                    handleOpenTableDataWithFilter(refTable, fkInfo.references_column, value);
                  }}
                  title={`View ${fkInfo.references_table} where ${fkInfo.references_column} = ${value}`}
                >
                  <ArrowRight className="w-3.5 h-3.5 text-primary" />
                </button>
              </span>
            );
          }

          return displayValue;
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
        if (typeof value === "object") return JSON.stringify(value);
        return String(value);
      },
    }));
  }, [activeTab]);

  if (loading || !connection) {
    return (
      <div className="flex items-center justify-center min-h-screen">
        <div className="text-muted-foreground">Loading...</div>
      </div>
    );
  }

  const tablesBySchema = tables.reduce((acc, table) => {
    if (!acc[table.schema]) {
      acc[table.schema] = [];
    }
    acc[table.schema].push(table);
    return acc;
  }, {} as Record<string, DatabaseTable[]>);

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
          <Button
            variant="outline"
            size="sm"
            onClick={handleRefreshTableData}
            disabled={tab.loading}
            className="ml-4"
          >
            {tab.loading ? (
              <Spinner className="mr-2" />
            ) : (
              <ArrowsClockwise className="w-4 h-4 mr-2" />
            )}
            Refresh Data
          </Button>
        </div>
      </CardHeader>
      <div className="px-6 pb-4">
        <div className="flex items-center gap-2">
          <Input
            placeholder="Filter: e.g. id = 1 AND status = 'active'"
            value={tab.filterInput}
            onChange={(e: React.ChangeEvent<HTMLInputElement>) => handleFilterInputChange(e.target.value)}
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
            Active filter: <code className="bg-muted px-1 py-0.5 rounded">{tab.filter}</code>
          </div>
        )}
      </div>
      <CardContent className="max-h-96 overflow-hidden">
        {tab.loading ? (
          <div className="flex items-center justify-center py-8">
            <Spinner />
          </div>
        ) : tab.data && tab.data.data.length > 0 ? (
          <DataTable
            data={tab.data.data}
            columns={tableDataColumns}
            pageCount={tableDataPageCount}
            currentPage={tab.currentPage}
            onPageChange={handlePageChange}
          />
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
          <div className="flex items-center justify-center py-8">
            <Spinner />
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
                            <span className="text-blue-600 font-semibold">✓</span>
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
                              <span className="text-blue-600 font-semibold">✓</span>
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

            {tab.structure.foreign_keys && tab.structure.foreign_keys.length > 0 && (
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
                      // Pre-populate name if this is an existing saved query
                      if (tab.savedQueryName) {
                        setSaveQueryName(tab.savedQueryName);
                      }
                      setShowSaveDialog(true);
                    }}
                    disabled={!tab.query.trim()}
                  >
                    <FloppyDisk className="w-4 h-4 mr-2" />
                    Save Query
                  </Button>
                  <Button
                    size="sm"
                    onClick={handleRunQuery}
                    disabled={tab.executing || !tab.query.trim()}
                  >
                    {tab.executing ? (
                      <>
                        <Spinner className="mr-2" />
                        Running...
                      </>
                    ) : (
                      <>
                        Run SQL{" "}
                        <span className="text-xs opacity-60">
                          ({navigator.platform.includes("Mac") ? "⌘" : "Ctrl"}+↵)
                        </span>
                      </>
                    )}
                  </Button>
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
            tables={tables.map(t => ({
              schema: t.schema,
              name: t.name,
              columns: tableColumns[`${t.schema}.${t.name}`]
            }))}
            onGenerateSQL={async (instruction, existingSQL) => {
              try {
                // Fetch schemas for all tables that don't have columns yet
                const tablesToFetch = tables.filter(
                  t => !tableColumns[`${t.schema}.${t.name}`]
                );

                if (tablesToFetch.length > 0 && connection) {
                  const schemaPromises = tablesToFetch.map(async (table) => {
                    try {
                      const data = await api.database.getTableStructure(
                        connection,
                        table.schema,
                        table.name
                      );
                      return {
                        key: `${table.schema}.${table.name}`,
                        columns: (data.columns as TableColumn[]) || []
                      };
                    } catch (error) {
                      console.error(`Failed to fetch schema for ${table.schema}.${table.name}:`, error);
                      return null;
                    }
                  });

                  const results = await Promise.all(schemaPromises);
                  const newColumns = { ...tableColumns };
                  results.forEach(result => {
                    if (result) {
                      newColumns[result.key] = result.columns;
                    }
                  });
                  setTableColumns(newColumns);

                  // Use the updated columns for generation
                  let generatedSQL = "";
                  await generateSQL(
                    instruction,
                    existingSQL,
                    tables.map(t => ({
                      schema: t.schema,
                      name: t.name,
                      columns: newColumns[`${t.schema}.${t.name}`]
                    })),
                    (chunk) => {
                      generatedSQL += chunk;
                      handleQueryChange(generatedSQL);
                    }
                  );
                } else {
                  // All schemas already cached
                  let generatedSQL = "";
                  await generateSQL(
                    instruction,
                    existingSQL,
                    tables.map(t => ({
                      schema: t.schema,
                      name: t.name,
                      columns: tableColumns[`${t.schema}.${t.name}`]
                    })),
                    (chunk) => {
                      generatedSQL += chunk;
                      handleQueryChange(generatedSQL);
                    }
                  );
                }
              } catch (error) {
                console.error("AI generation error:", error);
              }
            }}
            generating={generating}
            aiConfigured={aiConfigured}
          />
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Query Results</CardTitle>
          <CardDescription>
            {tab.results !== null &&
              tab.results.length > 0 &&
              `Returned ${tab.results.length} row${tab.results.length !== 1 ? "s" : ""
              }`}
            {tab.results !== null &&
              tab.results.length === 0 &&
              tab.success &&
              "Query executed successfully - no rows returned"}
            {tab.error && (
              <span className="text-destructive">Error: {tab.error}</span>
            )}
            {tab.executionTime !== null && (
              <span className="ml-2 text-muted-foreground">
                • Executed in {tab.executionTime}ms
              </span>
            )}
          </CardDescription>
        </CardHeader>
        <CardContent>
          {tab.executing ? (
            <div className="flex items-center justify-center py-8">
              <Spinner />
            </div>
          ) : tab.error ? (
            <div className="rounded-md bg-destructive/10 border border-destructive/20 p-4">
              <p className="text-sm text-destructive font-medium">Query Error</p>
              <p className="text-sm text-destructive/80 mt-1">{tab.error}</p>
            </div>
          ) : tab.results && tab.results.length > 0 ? (
            <div className="max-h-96 overflow-x-auto">
              <DataTable
                data={tab.results}
                columns={queryColumns}
                pageCount={1}
                currentPage={1}
                onPageChange={() => { }}
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
                No results yet. Write a SQL query and click &quot;Run SQL&quot; to
                execute it.
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
            Click on a table to view its data, or use the &quot;+&quot; button to create
            a new SQL query.
          </p>
          <p className="text-sm text-muted-foreground">
            Found {tables.length} tables across{" "}
            {Object.keys(tablesBySchema).length} schemas.
          </p>
        </div>
      </CardContent>
    </Card>
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
      default:
        return renderEmptyState();
    }
  };

  return (
    <SidebarProvider>
      <Sidebar>
        <SidebarHeader className="border-b p-4 pt-10">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <Table className="w-5 h-5" />
              <span className="font-semibold">{connection.name}</span>
            </div>
            <Button
              variant="ghost"
              size="icon-sm"
              onClick={handleRefreshTables}
              disabled={refreshingTables}
              title="Refresh tables list"
            >
              {refreshingTables ? (
                <Spinner />
              ) : (
                <ArrowsClockwise className="w-4 h-4" />
              )}
            </Button>
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
              {Object.entries(tablesBySchema).map(([schema, schemaTables]) => (
                <SidebarGroup key={schema}>
                  <SidebarGroupLabel>{schema}</SidebarGroupLabel>
                  <SidebarGroupContent>
                    <SidebarMenu>
                      {(schemaTables as DatabaseTable[]).map((table) => {
                        const tableName = `${table.schema}.${table.name}`;
                        const isExpanded = expandedTables.has(tableName);
                        const isLoading = loadingColumns.has(tableName);
                        const cols = tableColumns[tableName] || [];

                        return (
                          <Collapsible
                            key={tableName}
                            open={isExpanded}
                            onOpenChange={() =>
                              handleToggleTableExpand(tableName)
                            }
                          >
                            <SidebarMenuItem>
                              <CollapsibleTrigger
                                render={
                                  <SidebarMenuButton className="w-full" />
                                }
                              >
                                <CaretRight
                                  className={`w-3 h-3 transition-transform ${isExpanded ? "rotate-90" : ""
                                    }`}
                                />
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
                              </CollapsibleTrigger>
                              <DropdownMenu>
                                <DropdownMenuTrigger
                                  render={
                                    <button
                                      type="button"
                                      className="absolute right-1 top-1/2 -translate-y-1/2 p-1 rounded opacity-0 group-hover:opacity-100 hover:bg-sidebar-accent"
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
                                    <Table className="w-4 h-4 mr-2" />
                                    View Data
                                  </DropdownMenuItem>
                                  <DropdownMenuItem
                                    onClick={() =>
                                      handleRunQueryForTable(tableName)
                                    }
                                  >
                                    <Code className="w-4 h-4 mr-2" />
                                    Run Query
                                  </DropdownMenuItem>
                                  <DropdownMenuItem
                                    onClick={() =>
                                      handleOpenTableStructure(tableName)
                                    }
                                  >
                                    <Columns className="w-4 h-4 mr-2" />
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
                                        onClick={() => {
                                          // If there's an active query tab, insert column name
                                          if (
                                            activeTab &&
                                            activeTab.type === "query"
                                          ) {
                                            const queryTab = activeTab as QueryTab;
                                            handleQueryChange(
                                              queryTab.query + col.name
                                            );
                                          }
                                        }}
                                      >
                                        <span className="font-mono text-xs truncate">
                                          {col.name}
                                        </span>
                                        <span className="text-muted-foreground text-xs ml-auto truncate max-w-[80px]">
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
                        <SidebarMenuItem key={query.id} className="group/query">
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
                                onClick={() => handleDeleteQuery(query.id)}
                                variant="destructive"
                              >
                                Delete
                              </DropdownMenuItem>
                            </DropdownMenuContent>
                          </DropdownMenu>
                        </SidebarMenuItem>
                      ))}
                    </SidebarMenu>
                  )}
                </SidebarGroupContent>
              </SidebarGroup>
            </TabsContent>
          </Tabs>
        </SidebarContent>
      </Sidebar>

      <SidebarInset className="min-w-0 overflow-hidden flex flex-col">
        <ContentHeader connection={connection} navigate={navigate} />

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
    </SidebarProvider>
  );
}
