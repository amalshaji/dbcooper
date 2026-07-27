import { useCallback, useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import {
	type ConnectionStatus,
	type LoadingPhase,
} from "../../lib/connection-details/connectionLifecycleState";
import {
	prepareDuckDbRuntime,
	type DuckDbHelperProgress,
} from "../../lib/duckdbHelper";
import { api, type Connection } from "../../lib/tauri";
import type { DatabaseTable } from "../../types/table";
import type { SchemaOverview, TableColumn } from "../../types/tabTypes";

interface UseConnectionLifecycleOptions {
	uuid: string | undefined;
	navigate: (path: string) => void;
}

export function useConnectionLifecycle({
	uuid,
	navigate,
}: UseConnectionLifecycleOptions) {
	const [connection, setConnection] = useState<Connection | null>(null);
	const [loadingPhase, setLoadingPhase] =
		useState<LoadingPhase>("fetching-config");
	const [duckDbHelperProgress, setDuckDbHelperProgress] =
		useState<DuckDbHelperProgress | null>(null);
	const [tables, setTables] = useState<DatabaseTable[]>([]);
	const [tableColumns, setTableColumns] = useState<
		Record<string, TableColumn[]>
	>({});
	const [schemaOverview, setSchemaOverview] = useState<SchemaOverview | null>(
		null,
	);
	const [loadingSchemaOverview, setLoadingSchemaOverview] = useState(false);
	const [refreshingSchema, setRefreshingSchema] = useState(false);
	const [connectionStatus, setConnectionStatus] =
		useState<ConnectionStatus>("connected");
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

	const loadSchema = useCallback(async () => {
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
			setTableColumns(
				Object.fromEntries(
					data.tables.map((table) => [
						`${table.schema}.${table.name}`,
						table.columns,
					]),
				),
			);
			markConnected();
		} catch (error) {
			console.error("Failed to fetch schema overview:", error);
			setSchemaOverview(null);
			setTables([]);
			setTableColumns({});
			const message = error instanceof Error ? error.message : String(error);
			markDisconnected(message);
			toast.error("Connection failed", { description: message });
		} finally {
			setLoadingSchemaOverview(false);
		}
	}, [uuid, markConnected, markDisconnected]);

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
						await loadSchema();
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
		loadSchema,
		loadingPhase,
		markConnected,
		markDisconnected,
		uuid,
	]);

	const refreshSchema = useCallback(async () => {
		if (!uuid || refreshingSchema) return;
		setRefreshingSchema(true);
		setSchemaOverview(null);
		setTableColumns({});
		try {
			await loadSchema();
		} finally {
			setRefreshingSchema(false);
		}
	}, [uuid, refreshingSchema, loadSchema]);

	const reconnect = useCallback(async () => {
		if (!uuid) return;
		try {
			const connectResult = await api.pool.connect(uuid);
			if (connectResult.status !== "connected") {
				throw new Error(connectResult.error || "Connection failed");
			}
			markConnected();
			toast.success("Reconnected successfully");
			if (connection?.type !== "redis") await loadSchema();
		} catch (error) {
			const message = error instanceof Error ? error.message : String(error);
			markDisconnected(message);
			toast.error("Reconnection failed", { description: message });
			throw error;
		}
	}, [uuid, connection?.type, loadSchema, markConnected, markDisconnected]);

	const recordConnectionStatus = useCallback(
		(status: ConnectionStatus) => {
			if (status === "connected") {
				markConnected();
			} else {
				setConnectionStatus("disconnected");
			}
		},
		[markConnected],
	);

	return {
		opening: {
			phase: loadingPhase,
			duckDbHelperProgress,
		},
		connection: {
			value: connection,
			status: connectionStatus,
			error: connectionError,
			hasEverConnected,
		},
		schema: {
			tables,
			tableColumns,
			overview: schemaOverview,
			loading: loadingSchemaOverview,
			refreshing: refreshingSchema,
		},
		commands: {
			loadSchema,
			refreshSchema,
			reconnect,
			recordConnectionStatus,
		},
	};
}
