import { afterEach, beforeEach, expect, mock, test } from "bun:test";
import { GlobalRegistrator } from "@happy-dom/global-registrator";
import { useCallback, useState } from "react";
import type { SavedQuery } from "../../lib/tauri";
import { TabRequestController } from "../../lib/connection-details/tabRequestController";
import type { SqlConnection } from "../../types/connection";
import type { QueryTab, Tab } from "../../types/tabTypes";

if (!globalThis.document) GlobalRegistrator.register();

interface QueryResult {
	data: Record<string, unknown>[];
	error: string | null;
	time_taken_ms: number;
	rows_affected: number | null;
	row_count: number | null;
	truncated: boolean;
}

function deferred<T>() {
	let resolve: (value: T) => void = () => {};
	const promise = new Promise<T>((complete) => {
		resolve = complete;
	});
	return { promise, resolve };
}

let executeQueryResult = deferred<QueryResult>();
let createQueryResult = deferred<SavedQuery>();
let executeQueryCalls = 0;

mock.module("sonner", () => ({
	toast: {
		error: () => {},
		success: () => {},
		warning: () => {},
	},
}));

mock.module("../../lib/tauri", () => ({
	api: {
		pool: {
			executeQuery: () => {
				executeQueryCalls += 1;
				return executeQueryResult.promise;
			},
		},
		queries: {
			create: () => createQueryResult.promise,
			update: async () => {
				throw new Error("Unexpected update");
			},
			delete: async () => {},
			recordHistory: async () => {},
		},
	},
}));

const { act, cleanup, renderHook } = await import("@testing-library/react");
const { useQueryWorkspaceController } = await import(
	"./useQueryWorkspaceController"
);

beforeEach(() => {
	executeQueryResult = deferred<QueryResult>();
	createQueryResult = deferred<SavedQuery>();
	executeQueryCalls = 0;
});

afterEach(cleanup);

function queryTab(id: string, query: string): QueryTab {
	return {
		id,
		type: "query",
		title: "New Query",
		query,
		ai: { instruction: "", draft: { status: "idle" } },
		savedQueryId: null,
		savedQueryName: null,
		results: null,
		error: null,
		success: false,
		executionTime: null,
		affectedRows: null,
		executing: false,
		filterInput: "",
		filter: "",
		sort: null,
		resultBaseQuery: null,
	};
}

const connection: SqlConnection = {
	id: 1,
	uuid: "connection-1",
	type: "postgres",
	name: "Postgres",
	host: "localhost",
	port: 5432,
	database: "app",
	username: "postgres",
	password: "",
	ssl: 0,
	db_type: "postgres",
	file_path: null,
	ssh_enabled: 0,
	ssh_host: "",
	ssh_port: 22,
	ssh_user: "",
	ssh_password: "",
	ssh_key_path: "",
	ssh_use_key: 0,
	created_at: "2026-07-27 00:00:00",
	updated_at: "2026-07-27 00:00:00",
};

function renderController(firstQuery = "SELECT 1") {
	const first = queryTab("query-1", firstQuery);
	const second = queryTab("query-2", "SELECT 2");
	const requestController = new TabRequestController();
	return renderHook(() => {
		const [tabs, setTabs] = useState<Tab[]>([first, second]);
		const [activeTabId, setActiveTabId] = useState(first.id);
		const [savedQueries, setSavedQueries] = useState<SavedQuery[]>([]);
		const activeTab = tabs.find((tab) => tab.id === activeTabId) ?? null;
		const activeQueryTab = activeTab?.type === "query" ? activeTab : null;
		const updateQueryTab = useCallback(
			(tabId: string, changes: Partial<Omit<QueryTab, "id" | "type">>) => {
				setTabs((currentTabs) =>
					currentTabs.map((tab) =>
						tab.id === tabId && tab.type === "query"
							? { ...tab, ...changes }
							: tab,
					),
				);
			},
			[],
		);
		const controller = useQueryWorkspaceController({
			connection,
			activeTab: activeQueryTab,
			updateQueryTab,
			onSavedQueryCreated: (query) =>
				setSavedQueries((current) => [query, ...current]),
			onSavedQueryUpdated: (query) =>
				setSavedQueries((current) =>
					current.map((item) => (item.id === query.id ? query : item)),
				),
			onSavedQueryDeleted: (id) =>
				setSavedQueries((current) =>
					current.filter((query) => query.id !== id),
				),
			recordHistory: () => {},
			handleOpenQuery: () => {},
			requestController,
		});
		return {
			tabs,
			savedQueries,
			controller,
			selectTab: setActiveTabId,
			appendSavedQuery: (query: SavedQuery) =>
				setSavedQueries((current) => [...current, query]),
		};
	});
}

test("finishes a query on its originating tab after the user switches tabs", async () => {
	const { result } = renderController();

	let execution: Promise<void> | undefined;
	act(() => {
		execution = result.current.controller.commands.runQuery();
	});
	act(() => result.current.selectTab("query-2"));

	await act(async () => {
		executeQueryResult.resolve({
			data: [{ value: 1 }],
			error: null,
			time_taken_ms: 4,
			rows_affected: null,
			row_count: 1,
			truncated: false,
		});
		await execution;
	});

	expect(result.current.tabs[0]).toMatchObject({
		id: "query-1",
		results: [{ value: 1 }],
		executing: false,
	});
	expect(result.current.tabs[1]).toMatchObject({
		id: "query-2",
		results: null,
	});
});

test("keeps the newest query result when requests finish out of order", async () => {
	const { result } = renderController();
	const olderResult = deferred<QueryResult>();
	const newerResult = deferred<QueryResult>();

	executeQueryResult = olderResult;
	let olderExecution: Promise<void> | undefined;
	act(() => {
		olderExecution = result.current.controller.commands.runQuery();
	});

	executeQueryResult = newerResult;
	let newerExecution: Promise<void> | undefined;
	act(() => {
		newerExecution = result.current.controller.commands.runQuery();
	});

	await act(async () => {
		newerResult.resolve({
			data: [{ value: "newer" }],
			error: null,
			time_taken_ms: 2,
			rows_affected: null,
			row_count: 1,
			truncated: false,
		});
		await newerExecution;
	});
	await act(async () => {
		olderResult.resolve({
			data: [{ value: "older" }],
			error: null,
			time_taken_ms: 8,
			rows_affected: null,
			row_count: 1,
			truncated: false,
		});
		await olderExecution;
	});

	expect(result.current.tabs[0]).toMatchObject({
		id: "query-1",
		results: [{ value: "newer" }],
		executionTime: 2,
		executing: false,
	});
});

test("stops run-all before another statement after a newer query starts", async () => {
	const { result } = renderController("SELECT 1; SELECT 2;");
	const batchResult = deferred<QueryResult>();
	const newerResult = deferred<QueryResult>();

	executeQueryResult = batchResult;
	let batchExecution: Promise<void> | undefined;
	act(() => {
		batchExecution = result.current.controller.workspace.runAllQueries();
	});

	executeQueryResult = newerResult;
	let newerExecution: Promise<void> | undefined;
	act(() => {
		newerExecution = result.current.controller.commands.runQuery();
	});

	await act(async () => {
		batchResult.resolve({
			data: [{ value: "batch" }],
			error: null,
			time_taken_ms: 3,
			rows_affected: null,
			row_count: 1,
			truncated: false,
		});
		await batchExecution;
	});
	await act(async () => {
		newerResult.resolve({
			data: [{ value: "newer" }],
			error: null,
			time_taken_ms: 1,
			rows_affected: null,
			row_count: 1,
			truncated: false,
		});
		await newerExecution;
	});

	expect(executeQueryCalls).toBe(2);
	expect(result.current.tabs[0]).toMatchObject({
		results: [{ value: "newer" }],
		executing: false,
	});
});

test("preserves saved queries added while a create request is in flight", async () => {
	const { result } = renderController();
	const refreshedQuery: SavedQuery = {
		id: 2,
		connection_uuid: connection.uuid,
		name: "Refreshed",
		query: "SELECT 2",
		query_kind: "sql",
		created_at: "2026-07-27 00:00:00",
		updated_at: "2026-07-27 00:00:00",
	};
	const createdQuery: SavedQuery = {
		...refreshedQuery,
		id: 1,
		name: "Created",
		query: "SELECT 1",
	};

	act(() => result.current.controller.workspace.changeSaveQueryName("Created"));
	let saving: Promise<void> | undefined;
	act(() => {
		saving = result.current.controller.workspace.saveQuery();
	});
	act(() => result.current.appendSavedQuery(refreshedQuery));

	await act(async () => {
		createQueryResult.resolve(createdQuery);
		await saving;
	});

	expect(result.current.savedQueries.map((query) => query.id)).toEqual([1, 2]);
});
