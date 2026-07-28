import { afterEach, expect, mock, test } from "bun:test";
import { GlobalRegistrator } from "@happy-dom/global-registrator";
import type { MongoFindRequest } from "../../lib/tauri";

if (!globalThis.document) GlobalRegistrator.register();

const findRequests: MongoFindRequest[] = [];
const historyRecords: Array<Record<string, unknown>> = [];

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

const { cleanup, renderHook, waitFor } = await import("@testing-library/react");
const { useMongoWorkbench } = await import("./useMongoWorkbench");

afterEach(() => {
	cleanup();
	findRequests.length = 0;
	historyRecords.length = 0;
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
