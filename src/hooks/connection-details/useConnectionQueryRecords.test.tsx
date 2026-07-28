import { afterEach, beforeEach, expect, mock, test } from "bun:test";
import { GlobalRegistrator } from "@happy-dom/global-registrator";
import type { SavedQuery } from "../../lib/tauri";
import { TabRequestController } from "../../lib/connection-details/tabRequestController";

if (!globalThis.document) GlobalRegistrator.register();

let listCalls = 0;
let historyCalls = 0;
let clearCalls = 0;

const savedQuery: SavedQuery = {
	id: 1,
	connection_uuid: "connection-1",
	name: "Users",
	query: "SELECT * FROM users",
	created_at: "2026-07-27 00:00:00",
	updated_at: "2026-07-27 00:00:00",
};

const historyEntry = {
	id: 2,
	connection_uuid: "connection-1",
	query: "SELECT 1",
	status: "success" as const,
	time_taken_ms: 1,
	row_count: 1,
	rows_affected: null,
	error: null,
	executed_at: "2026-07-27 00:00:00",
};

mock.module("../../lib/tauri", () => ({
	api: {
		queries: {
			list: async () => {
				listCalls += 1;
				return [savedQuery];
			},
			history: async () => {
				historyCalls += 1;
				return [historyEntry];
			},
			clearHistory: async () => {
				clearCalls += 1;
			},
			recordHistory: async () => {},
		},
	},
}));

const { act, cleanup, renderHook, waitFor } = await import(
	"@testing-library/react"
);
const { useConnectionQueryRecords } = await import(
	"./useConnectionQueryRecords"
);

beforeEach(() => {
	listCalls = 0;
	historyCalls = 0;
	clearCalls = 0;
});

afterEach(cleanup);

test("loads only the selected record panel and clears history atomically", async () => {
	const requestController = new TabRequestController();
	const { result, rerender } = renderHook(
		({ activePanel }: { activePanel: "objects" | "queries" | "history" }) =>
			useConnectionQueryRecords({
				uuid: "connection-1",
				activePanel,
				requestController,
			}),
		{
			initialProps: {
				activePanel: "objects" as "objects" | "queries" | "history",
			},
		},
	);

	expect(listCalls).toBe(0);
	expect(historyCalls).toBe(0);

	rerender({ activePanel: "queries" });
	await waitFor(() =>
		expect(result.current.savedQueries.items).toEqual([savedQuery]),
	);
	expect(listCalls).toBe(1);
	expect(historyCalls).toBe(0);

	rerender({ activePanel: "history" });
	await waitFor(() =>
		expect(result.current.history.items).toEqual([historyEntry]),
	);
	expect(historyCalls).toBe(1);

	await act(async () => {
		result.current.history.record("SELECT 2", { status: "success" });
	});
	await waitFor(() => expect(historyCalls).toBe(2));

	await act(async () => result.current.history.clear());
	expect(clearCalls).toBe(1);
	expect(result.current.history.items).toEqual([]);
});
