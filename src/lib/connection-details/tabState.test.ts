import { describe, expect, test } from "bun:test";
import type { QueryTab, TableDataTab } from "../../types/tabTypes";
import { applyTabPatch, type TabPatch } from "./tabState";

function queryTab(): QueryTab {
	return {
		id: "query-1",
		type: "query",
		title: "New Query",
		query: "SELECT 1",
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

function tableTab(): TableDataTab {
	return {
		id: "table-1",
		type: "table-data",
		title: "users",
		tableName: "public.users",
		data: null,
		currentPage: 1,
		loading: false,
		filterState: {
			draft: {
				kind: "structured",
				value: { conjunction: "and", conditions: [] },
			},
			applied: null,
		},
		foreignKeys: [],
		columns: [],
		sort: null,
		columnLayout: { columnOrder: [], hiddenColumns: [], columnWidths: {} },
		savedViewId: null,
	};
}

describe("connection tab state", () => {
	test("updates only the matching tab type and id", () => {
		const query = queryTab();
		const table = tableTab();

		const updated = applyTabPatch([query, table], {
			type: "query",
			tabId: query.id,
			changes: { executing: true },
		});

		expect(updated[0]).toEqual({ ...query, executing: true });
		expect(updated[1]).toBe(table);
	});

	test("refuses to apply a patch when the id belongs to another tab type", () => {
		const table = tableTab();
		const mismatchedPatch = {
			type: "query",
			tabId: table.id,
			changes: { executing: true },
		} satisfies TabPatch;

		expect(applyTabPatch([table], mismatchedPatch)).toEqual([table]);
	});
});
