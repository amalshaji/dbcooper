import { useCallback, useState } from "react";
import { toast } from "sonner";
import { api, type Connection } from "@/lib/tauri";
import {
	buildWrappedQuery,
	isWrappableQuery,
	serializeRowsToCsv,
	stripTrailingSemicolon,
} from "@/lib/connection-details/queryTableState";
import {
	getStatementAtCursor,
	parseStatements as parseSqlStatements,
} from "@/lib/sqlParser";
import type { SavedQuery } from "@/types/savedQuery";
import type { QueryTab, SortConfig, Tab } from "@/types/tabTypes";
import type { HistoryRecordOptions } from "./useConnectionLifecycle";

type UpdateQueryTab = (
	tabId: string,
	changes: Partial<Omit<QueryTab, "id" | "type">>,
) => void;

interface UseQueryWorkspaceControllerOptions {
	uuid: string | undefined;
	connection: Connection | null;
	activeTab: Tab | null;
	updateQueryTab: UpdateQueryTab;
	savedQueries: SavedQuery[];
	setSavedQueries: (queries: SavedQuery[]) => void;
	recordHistory: (query: string, options: HistoryRecordOptions) => void;
	handleOpenQuery: (
		query: string,
		savedQueryId?: number | null,
		savedQueryName?: string | null,
	) => void;
}

export function useQueryWorkspaceController({
	uuid,
	connection,
	activeTab,
	updateQueryTab,
	savedQueries,
	setSavedQueries,
	recordHistory,
	handleOpenQuery,
}: UseQueryWorkspaceControllerOptions) {
	const [saveQueryName, setSaveQueryName] = useState("");
	const [showSaveDialog, setShowSaveDialog] = useState(false);
	const [cursorLine, setCursorLine] = useState(0);
	const [cursorChar, setCursorChar] = useState(0);
	const [queryToDelete, setQueryToDelete] = useState<SavedQuery | null>(null);
	const [showQueryDeleteDialog, setShowQueryDeleteDialog] = useState(false);

	const runQueryResultViewQuery = useCallback(
		async (tab: QueryTab, nextFilter: string, nextSort: SortConfig | null) => {
			if (!uuid) return;

			if (!tab.resultBaseQuery) {
				updateQueryTab(tab.id, { executing: false });
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
					updateQueryTab(tab.id, {
						error: result.error,
						executionTime,
						affectedRows: null,
						executing: false,
					});
					return;
				}

				updateQueryTab(tab.id, {
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
				updateQueryTab(tab.id, {
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
			[uuid, updateQueryTab, connection?.db_type, connection?.type],
	);

	const handleQueryFilterInputChange = useCallback(
		(value: string) => {
			if (activeTab?.type !== "query") return;
			updateQueryTab(activeTab.id, { filterInput: value });
		},
		[activeTab, updateQueryTab],
	);

	const handleApplyQueryFilter = useCallback(() => {
		if (activeTab?.type !== "query") return;
		updateQueryTab(activeTab.id, {
			filter: activeTab.filterInput,
			executing: true,
			error: null,
		});
		void runQueryResultViewQuery(
			activeTab,
			activeTab.filterInput,
			activeTab.sort,
		);
	}, [activeTab, updateQueryTab, runQueryResultViewQuery]);

	const handleClearQueryFilter = useCallback(() => {
		if (activeTab?.type !== "query") return;
		updateQueryTab(activeTab.id, {
			filter: "",
			filterInput: "",
			executing: true,
			error: null,
		});
		void runQueryResultViewQuery(activeTab, "", activeTab.sort);
	}, [activeTab, updateQueryTab, runQueryResultViewQuery]);

	const handleQuerySortChange = useCallback(
		(sort: SortConfig | null) => {
			if (activeTab?.type !== "query") return;
			updateQueryTab(activeTab.id, {
				sort,
				executing: true,
				error: null,
			});
			void runQueryResultViewQuery(activeTab, activeTab.filter, sort);
		},
		[activeTab, updateQueryTab, runQueryResultViewQuery],
	);

	const handleRunQuery = useCallback(async () => {
		if (activeTab?.type !== "query" || !uuid) return;
		if (!activeTab.query.trim()) {
			toast.error("Cannot execute empty query");
			return;
		}

		const statement = getStatementAtCursor(
			activeTab.query,
			cursorLine,
			cursorChar,
		);
		const queryToRun = statement?.text.trim() || "";
		if (!queryToRun) {
			toast.error("No statement at cursor position");
			return;
		}

		updateQueryTab(activeTab.id, {
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
			const executionTime = result.time_taken_ms ?? 0;

			if (result.error) {
				updateQueryTab(activeTab.id, {
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

			updateQueryTab(activeTab.id, {
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
			updateQueryTab(activeTab.id, {
				error: message,
				executionTime: null,
				affectedRows: null,
				executing: false,
			});
			recordHistory(queryToRun, { status: "error", error: message });
		}
	}, [activeTab, uuid, updateQueryTab, cursorLine, cursorChar, recordHistory]);

	const handleRunAllQueries = useCallback(async () => {
		if (activeTab?.type !== "query" || !uuid || !activeTab.query.trim()) return;
		const statements = parseSqlStatements(activeTab.query);
		if (statements.length === 0) return;

		updateQueryTab(activeTab.id, {
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

			updateQueryTab(
				activeTab.id,
				lastError
					? {
							error: lastError,
							executionTime: totalTime,
							affectedRows: null,
							executing: false,
						}
					: {
							results: lastResult,
							success: true,
							executionTime: totalTime,
							affectedRows: lastAffectedRows,
							executing: false,
							filterInput: "",
							filter: "",
							sort: null,
							resultBaseQuery: lastBaseQuery,
						},
			);
		} catch (error) {
			updateQueryTab(activeTab.id, {
				error:
					error instanceof Error ? error.message : "Failed to execute queries",
				executionTime: null,
				affectedRows: null,
				executing: false,
			});
		}
	}, [activeTab, uuid, updateQueryTab, recordHistory]);

	const handleQueryChange = useCallback(
		(query: string) => {
			if (activeTab?.type !== "query") return;
			updateQueryTab(activeTab.id, { query });
		},
		[activeTab, updateQueryTab],
	);

	const handleInsertQueryText = useCallback(
		(text: string) => {
			if (activeTab?.type !== "query") return;
			const needsSpace =
				activeTab.query.length > 0 &&
				!activeTab.query.endsWith(" ") &&
				!activeTab.query.endsWith("\n") &&
				!activeTab.query.endsWith("\t");
			handleQueryChange(activeTab.query + (needsSpace ? " " : "") + text);
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
		if (activeTab?.type !== "query" || !uuid) return;
		if (!activeTab.query.trim() || !saveQueryName.trim()) return;

		try {
			if (activeTab.savedQueryId) {
				const updatedQuery = await api.queries.update(activeTab.savedQueryId, {
					name: saveQueryName,
					query: activeTab.query,
				});
				setSavedQueries(
					savedQueries.map((query) =>
						query.id === activeTab.savedQueryId
							? (updatedQuery as SavedQuery)
							: query,
					),
				);
				updateQueryTab(activeTab.id, {
					savedQueryName: updatedQuery.name,
					title: updatedQuery.name,
				});
				toast.success("Query updated successfully");
			} else {
				const newQuery = await api.queries.create(uuid, {
					name: saveQueryName,
					query: activeTab.query,
				});
				setSavedQueries([newQuery as SavedQuery, ...savedQueries]);
				updateQueryTab(activeTab.id, {
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
			setSavedQueries(
				savedQueries.filter((query) => query.id !== queryToDelete.id),
			);
			setShowQueryDeleteDialog(false);
			setQueryToDelete(null);
			toast.success("Query deleted successfully");
		} catch (error) {
			console.error("Failed to delete query:", error);
			toast.error("Failed to delete query");
		}
	};

	const handleExportCSV = useCallback(async () => {
		if (activeTab?.type !== "query" || !activeTab.results?.length) return;
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

		try {
			await writeTextFile(filePath, serializeRowsToCsv(activeTab.results));
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

	const handleSaveQueryFromPalette = useCallback(() => {
		if (activeTab?.type !== "query" || !activeTab.query.trim()) return;
		if (activeTab.savedQueryName) setSaveQueryName(activeTab.savedQueryName);
		setShowSaveDialog(true);
	}, [activeTab]);

	return {
		saveQueryName,
		setSaveQueryName,
		showSaveDialog,
		setShowSaveDialog,
		setCursorLine,
		setCursorChar,
		queryToDelete,
		showQueryDeleteDialog,
		setShowQueryDeleteDialog,
		handleQueryFilterInputChange,
		handleApplyQueryFilter,
		handleClearQueryFilter,
		handleQuerySortChange,
		handleRunQuery,
		handleRunAllQueries,
		handleQueryChange,
		handleInsertQueryText,
		handleCopyQueryError,
		handleLoadQuery,
		handleSaveQuery,
		handleDeleteQuery,
		confirmDeleteQuery,
		handleExportCSV,
		handleSaveQueryFromPalette,
	};
}
