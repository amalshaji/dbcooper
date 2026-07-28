import { afterEach, expect, mock, test } from "bun:test";
import { GlobalRegistrator } from "@happy-dom/global-registrator";
import type { MongoFindRequest } from "../../lib/tauri";

if (!globalThis.document) GlobalRegistrator.register();

const findRequests: MongoFindRequest[] = [];
const historyRecords: Array<Record<string, unknown>> = [];
const createdCollections: Array<{ database: string; collection: string }> = [];

mock.module("../../lib/tauri", () => ({
	api: {
		mongo: {
			listCatalog: async () => [
				{
					name: "app",
					collections: [{ database: "app", name: "users" }],
				},
			],
			find: async (_uuid: string, request: MongoFindRequest) => {
				findRequests.push(request);
				return {
					documents: [{ _id: 1, name: "Ada" }],
					returned_count: 1,
					has_more: false,
					execution_time_ms: 1,
					estimated_total: 1,
				};
			},
			aggregate: async () => {
				throw new Error("not used");
			},
			createCollection: async (
				_uuid: string,
				database: string,
				collection: string,
			) => {
				createdCollections.push({ database, collection });
			},
		},
		queries: {
			list: async () => [],
			history: async () => [],
			recordHistory: async (record: Record<string, unknown>) => {
				historyRecords.push(record);
			},
		},
	},
}));

const { act, cleanup, renderHook, waitFor } = await import(
	"@testing-library/react"
);
const { useMongoWorkbench } = await import("./useMongoWorkbench");

afterEach(() => {
	cleanup();
	findRequests.length = 0;
	historyRecords.length = 0;
	createdCollections.length = 0;
});

test("loads the first namespace and records the exact query specification it runs", async () => {
	const { result } = renderHook(() => useMongoWorkbench("connection-1"));

	await waitFor(() => expect(result.current.result?.returned_count).toBe(1));

	expect(findRequests).toHaveLength(1);
	expect(findRequests[0]).toMatchObject({
		database: "app",
		collection: "users",
		filter: {},
		projection: {},
		sort: {},
		limit: 100,
	});
	expect(historyRecords).toHaveLength(1);
	expect(historyRecords[0].queryKind).toBe("mongo_find");
	expect(JSON.parse(String(historyRecords[0].query))).toMatchObject(
		findRequests[0],
	);
});

test("restores a history query without executing or recording it again", async () => {
	const { result } = renderHook(() => useMongoWorkbench("connection-1"));

	await waitFor(() => expect(result.current.result?.returned_count).toBe(1));
	findRequests.length = 0;
	historyRecords.length = 0;

	await act(async () => {
		result.current.actions.loadQuery(
			JSON.stringify({
				version: 1,
				type: "find",
				database: "app",
				collection: "users",
				filter: { active: true },
				projection: { name: 1 },
				sort: { name: 1 },
				limit: 100,
			}),
		);
	});

	expect(result.current.editor).toMatchObject({
		type: "find",
		filter: '{\n  "active": true\n}',
		projection: '{\n  "name": 1\n}',
	});
	expect(result.current.result).toBeNull();
	expect(findRequests).toHaveLength(0);
	expect(historyRecords).toHaveLength(0);
});

test("selects a newly created collection so the create action has a visible result", async () => {
	const { result } = renderHook(() => useMongoWorkbench("connection-1"));

	await waitFor(() => expect(result.current.result?.returned_count).toBe(1));
	findRequests.length = 0;
	historyRecords.length = 0;

	await act(async () => {
		await result.current.actions.createCollection("app.logs");
	});
	await waitFor(() => expect(result.current.namespace.collection).toBe("logs"));
	await waitFor(() => expect(findRequests).toHaveLength(1));

	expect(createdCollections).toEqual([{ database: "app", collection: "logs" }]);
	expect(result.current.expanded.has("app")).toBe(true);
});

test("creates a bare collection name in the selected database", async () => {
	const { result } = renderHook(() => useMongoWorkbench("connection-1"));

	await waitFor(() => expect(result.current.namespace.database).toBe("app"));

	await act(async () => {
		await result.current.actions.createCollection("logs");
	});

	expect(createdCollections).toEqual([{ database: "app", collection: "logs" }]);
	expect(result.current.namespace).toEqual({
		database: "app",
		collection: "logs",
	});
});
