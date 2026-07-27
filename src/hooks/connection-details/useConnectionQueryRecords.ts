import { useCallback, useEffect, useState } from "react";
import { api, type QueryHistory } from "../../lib/tauri";
import type { SavedQuery } from "../../types/savedQuery";

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
}

export function useConnectionQueryRecords({
	uuid,
	activePanel,
}: UseConnectionQueryRecordsOptions) {
	const [savedQueries, setSavedQueries] = useState<SavedQuery[]>([]);
	const [loadingQueries, setLoadingQueries] = useState(false);
	const [queryHistory, setQueryHistory] = useState<QueryHistory[]>([]);
	const [loadingHistory, setLoadingHistory] = useState(false);

	useEffect(() => {
		if (!uuid || activePanel !== "queries") return;
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
	}, [uuid, activePanel]);

	const fetchQueryHistory = useCallback(async () => {
		if (!uuid) return;
		try {
			setQueryHistory(await api.queries.history(uuid));
		} catch (error) {
			console.error("Failed to fetch query history:", error);
		}
	}, [uuid]);

	useEffect(() => {
		if (!uuid || activePanel !== "history") return;
		setLoadingHistory(true);
		void fetchQueryHistory().finally(() => setLoadingHistory(false));
	}, [uuid, activePanel, fetchQueryHistory]);

	const recordHistory = useCallback(
		(query: string, options: HistoryRecordOptions) => {
			if (!uuid) return;
			api.queries
				.recordHistory({ connectionUuid: uuid, query, ...options })
				.then(() => {
					if (activePanel === "history") void fetchQueryHistory();
				})
				.catch((error) =>
					console.error("Failed to record query history:", error),
				);
		},
		[uuid, activePanel, fetchQueryHistory],
	);

	const clearHistory = useCallback(async () => {
		if (!uuid) return;
		try {
			await api.queries.clearHistory(uuid);
			setQueryHistory([]);
		} catch (error) {
			console.error("Failed to clear query history:", error);
		}
	}, [uuid]);

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
