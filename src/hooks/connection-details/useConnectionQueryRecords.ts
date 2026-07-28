import { useCallback, useEffect, useState } from "react";
import { api, type QueryHistory, type SavedQuery } from "../../lib/tauri";
import type { TabRequestController } from "../../lib/connection-details/tabRequestController";

export interface HistoryRecordOptions {
	status: "success" | "error";
	timeTakenMs?: number | null;
	rowCount?: number | null;
	rowsAffected?: number | null;
	error?: string | null;
}

interface UseConnectionQueryRecordsOptions {
	uuid: string | undefined;
	activePanel: "objects" | "queries" | "history";
	requestController: TabRequestController;
}

export function useConnectionQueryRecords({
	uuid,
	activePanel,
	requestController,
}: UseConnectionQueryRecordsOptions) {
	const [savedQueries, setSavedQueries] = useState<SavedQuery[]>([]);
	const [loadingQueries, setLoadingQueries] = useState(false);
	const [queryHistory, setQueryHistory] = useState<QueryHistory[]>([]);
	const [loadingHistory, setLoadingHistory] = useState(false);

	useEffect(() => {
		if (!uuid || activePanel !== "queries") return;
		const fetchSavedQueries = async () => {
			const lifecycle = requestController.watchLifecycle();
			setLoadingQueries(true);
			try {
				const queries = await api.queries.list(uuid);
				if (lifecycle.isCurrent()) setSavedQueries(queries);
			} catch (error) {
				if (lifecycle.isCurrent()) {
					console.error("Failed to fetch saved queries:", error);
				}
			} finally {
				if (lifecycle.isCurrent()) setLoadingQueries(false);
			}
		};
		void fetchSavedQueries();
	}, [uuid, activePanel, requestController]);

	const fetchQueryHistory = useCallback(async () => {
		if (!uuid) return;
		const lifecycle = requestController.watchLifecycle();
		try {
			const history = await api.queries.history(uuid);
			if (lifecycle.isCurrent()) setQueryHistory(history);
		} catch (error) {
			if (lifecycle.isCurrent()) {
				console.error("Failed to fetch query history:", error);
			}
		}
	}, [uuid, requestController]);

	useEffect(() => {
		if (!uuid || activePanel !== "history") return;
		const lifecycle = requestController.watchLifecycle();
		setLoadingHistory(true);
		void fetchQueryHistory().finally(() => {
			if (lifecycle.isCurrent()) setLoadingHistory(false);
		});
	}, [uuid, activePanel, fetchQueryHistory, requestController]);

	const recordHistory = useCallback(
		(query: string, options: HistoryRecordOptions) => {
			if (!uuid) return;
			const lifecycle = requestController.watchLifecycle();
			api.queries
				.recordHistory({ connectionUuid: uuid, query, ...options })
				.then(() => {
					if (lifecycle.isCurrent() && activePanel === "history") {
						void fetchQueryHistory();
					}
				})
				.catch((error) =>
					console.error("Failed to record query history:", error),
				);
		},
		[uuid, activePanel, fetchQueryHistory, requestController],
	);

	const clearHistory = useCallback(async () => {
		if (!uuid) return;
		const lifecycle = requestController.watchLifecycle();
		try {
			await api.queries.clearHistory(uuid);
			if (lifecycle.isCurrent()) setQueryHistory([]);
		} catch (error) {
			if (lifecycle.isCurrent()) {
				console.error("Failed to clear query history:", error);
			}
		}
	}, [uuid, requestController]);

	const addSavedQuery = useCallback((query: SavedQuery) => {
		setSavedQueries((currentQueries) => [query, ...currentQueries]);
	}, []);

	const replaceSavedQuery = useCallback((query: SavedQuery) => {
		setSavedQueries((currentQueries) =>
			currentQueries.map((current) =>
				current.id === query.id ? query : current,
			),
		);
	}, []);

	const removeSavedQuery = useCallback((id: number) => {
		setSavedQueries((currentQueries) =>
			currentQueries.filter((query) => query.id !== id),
		);
	}, []);

	return {
		savedQueries: {
			items: savedQueries,
			loading: loadingQueries,
			add: addSavedQuery,
			replace: replaceSavedQuery,
			remove: removeSavedQuery,
		},
		history: {
			items: queryHistory,
			loading: loadingHistory,
			record: recordHistory,
			clear: clearHistory,
		},
	};
}
