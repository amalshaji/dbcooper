import {
	type Dispatch,
	type SetStateAction,
	useCallback,
	useEffect,
	useRef,
	useState,
} from "react";
import { toast } from "sonner";
import { prepareDuckDbRuntime } from "@/lib/duckdbHelper";
import type { DuckDbHelperProgress } from "@/lib/duckdbHelper";
import { api, type Connection, type QueryHistory } from "@/lib/tauri";
import type { SavedQuery } from "@/types/savedQuery";
import type { DatabaseTable } from "@/types/table";
import type { LoadingPhase } from "@/components/connection-details/ConnectionOpeningScreen";
import type { SchemaOverview, Tab, TableColumn } from "@/types/tabTypes";

interface UseConnectionLifecycleOptions {
	uuid: string | undefined;
	navigate: (path: string) => void;
	sidebarTab: "objects" | "queries" | "history";
	setTabs: Dispatch<SetStateAction<Tab[]>>;
}

export interface HistoryRecordOptions {
	status: "success" | "error";
	timeTakenMs?: number | null;
	rowCount?: number | null;
	rowsAffected?: number | null;
	error?: string | null;
}

export function useConnectionLifecycle({
	uuid,
	navigate,
	sidebarTab,
	setTabs,
}: UseConnectionLifecycleOptions) {
	const [connection, setConnection] = useState<Connection | null>(null);
	const [tables, setTables] = useState<DatabaseTable[]>([]);
	const [loadingPhase, setLoadingPhase] =
		useState<LoadingPhase>("fetching-config");
	const [duckDbHelperProgress, setDuckDbHelperProgress] =
		useState<DuckDbHelperProgress | null>(null);
	const [refreshingTables, setRefreshingTables] = useState(false);
	const [savedQueries, setSavedQueries] = useState<SavedQuery[]>([]);
	const [loadingQueries, setLoadingQueries] = useState(false);
	const [queryHistory, setQueryHistory] = useState<QueryHistory[]>([]);
	const [loadingHistory, setLoadingHistory] = useState(false);
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
	const [hasEverConnected, setHasEverConnected] = useState(false);
	const hasStartedLoading = useRef(false);

	const markConnected = useCallback(() => {
		setConnectionStatus("connected");
		setConnectionError(null);
		setHasEverConnected(true);
	}, []);

	const markDisconnected = useCallback((error: string) => {
		setConnectionStatus("disconnected");
		setConnectionError(error);
	}, []);

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
						await prepareDuckDbRuntime(data.type, setDuckDbHelperProgress);
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
				setLoadingPhase(data.ssh_enabled ? "establishing-ssh" : "connecting");
			} catch (error) {
				console.error("Failed to fetch connection:", error);
				navigate("/");
			}
		};

		if (uuid) void fetchConnection();
	}, [uuid, navigate, markDisconnected]);

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
			setTables(
				data.tables.map((table) => ({
					schema: table.schema,
					name: table.name,
					type: table.type === "view" ? "view" : "table",
				})),
			);
			markConnected();

			setTableColumns(
				Object.fromEntries(
					data.tables.map((table) => [
						`${table.schema}.${table.name}`,
						table.columns,
					]),
				),
			);

			const allTableNames = data.tables.map(
				(table) => `${table.schema}.${table.name}`,
			);
			setTabs((previous) =>
				previous.map((tab) =>
					tab.type === "schema-visualizer" && tab.selectedTables.length === 0
						? { ...tab, selectedTables: allTableNames }
						: tab,
				),
			);
		} catch (error) {
			console.error("Failed to fetch schema overview:", error);
			setSchemaOverview(null);
			setTables([]);
			const message = error instanceof Error ? error.message : String(error);
			markDisconnected(message);
			toast.error("Connection failed", { description: message });
		} finally {
			setLoadingSchemaOverview(false);
		}
	}, [uuid, markConnected, markDisconnected, setTabs]);

	useEffect(() => {
		hasStartedLoading.current = false;
	}, [connection]);

	useEffect(() => {
		const shouldStartLoading =
			connection &&
			(loadingPhase === "connecting" || loadingPhase === "establishing-ssh") &&
			!hasStartedLoading.current;

		if (!shouldStartLoading || !uuid) return;

		hasStartedLoading.current = true;
		const loadData = async () => {
			try {
				const connectResult = await api.pool.connect(uuid);
				if (connectResult.status === "connected") {
					markConnected();
					if (connection.type !== "redis") {
						setLoadingPhase("loading-schema");
						await fetchSchemaOverviewData();
					}
				} else {
					const message = connectResult.error || "Connection failed";
					markDisconnected(message);
					toast.error("Connection failed", { description: message });
				}
			} catch (error) {
				const message = error instanceof Error ? error.message : String(error);
				markDisconnected(message);
				toast.error("Connection failed", { description: message });
			} finally {
				setLoadingPhase("complete");
			}
		};

		void loadData().catch((error) => {
			console.error("Failed to load connection data:", error);
			markDisconnected(error instanceof Error ? error.message : String(error));
			setLoadingPhase("complete");
		});
	}, [
		connection,
		fetchSchemaOverviewData,
		loadingPhase,
		markConnected,
		markDisconnected,
		uuid,
	]);

	useEffect(() => {
		if (!uuid || sidebarTab !== "queries") return;
		const fetchSavedQueries = async () => {
			setLoadingQueries(true);
			try {
				setSavedQueries((await api.queries.list(uuid)) as SavedQuery[]);
			} catch (error) {
				console.error("Failed to fetch saved queries:", error);
			} finally {
				setLoadingQueries(false);
			}
		};
		void fetchSavedQueries();
	}, [uuid, sidebarTab]);

	const fetchQueryHistory = useCallback(async () => {
		if (!uuid) return;
		try {
			setQueryHistory(await api.queries.history(uuid));
		} catch (error) {
			console.error("Failed to fetch query history:", error);
		}
	}, [uuid]);

	const recordHistory = useCallback(
		(query: string, options: HistoryRecordOptions) => {
			if (!uuid) return;
			api.queries
				.recordHistory({ connectionUuid: uuid, query, ...options })
				.then(() => {
					if (sidebarTab === "history") void fetchQueryHistory();
				})
				.catch((error) =>
					console.error("Failed to record query history:", error),
				);
		},
		[uuid, sidebarTab, fetchQueryHistory],
	);

	useEffect(() => {
		if (!uuid || sidebarTab !== "history") return;
		setLoadingHistory(true);
		void fetchQueryHistory().finally(() => setLoadingHistory(false));
	}, [uuid, sidebarTab, fetchQueryHistory]);

	return {
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
	};
}
