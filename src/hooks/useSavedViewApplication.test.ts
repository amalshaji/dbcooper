import { describe, expect, test } from "bun:test";
import { createTableFilterState } from "../lib/resultFilters";
import { captureSavedViewState, createColumnLayout } from "../lib/savedViews";
import type { SavedView } from "../lib/tauri";
import type { TableDataTab } from "../types/tabTypes";
import { prepareSavedViewApplication } from "./useSavedViewApplication";

function tableTab(): TableDataTab {
	return {
		id: "table-data-public.events",
		type: "table-data",
		title: "events",
		tableName: "public.events",
		data: null,
		currentPage: 1,
		loading: false,
		filterState: createTableFilterState(),
		foreignKeys: [],
		columns: [],
		sort: null,
		columnLayout: createColumnLayout([]),
		savedViewId: null,
	};
}

describe("prepareSavedViewApplication", () => {
	test("builds one atomic tab state for a compatible saved view", () => {
		const tab = tableTab();
		tab.currentPage = 4;
		tab.columns = [
			{
				name: "id",
				type: "text",
				filter_kind: "text",
				nullable: false,
				default: null,
				primary_key: true,
			},
		];
		const filter = { kind: "advanced" as const, value: "id IS NOT NULL" };
		const state = captureSavedViewState(
			filter,
			{ column: "id", direction: "desc" },
			{ ...createColumnLayout(["id"]), columnWidths: { id: 220 } },
		);
		const view: SavedView = {
			id: 7,
			connection_uuid: "connection-1",
			table_name: tab.tableName,
			name: "Recent",
			state: { status: "current", state },
			created_at: "2026-07-26 12:00:00",
			updated_at: "2026-07-26 12:00:00",
		};

		const result = prepareSavedViewApplication(tab, view);

		expect(result.error).toBeNull();
		expect(result.nextTab?.currentPage).toBe(1);
		expect(result.nextTab?.filterState).toEqual({
			draft: filter,
			applied: filter,
		});
		expect(result.nextTab?.sort).toEqual(state.sort);
		expect(result.nextTab?.columnLayout.columnWidths).toEqual({ id: 220 });
	});

	test("returns a compatibility error without creating a partial tab state", () => {
		const tab = tableTab();
		tab.columns = [];
		const view: SavedView = {
			id: 8,
			connection_uuid: "connection-1",
			table_name: tab.tableName,
			name: "Future",
			state: { status: "unsupported", version: 2 },
			created_at: "2026-07-26 12:00:00",
			updated_at: "2026-07-26 12:00:00",
		};

		const result = prepareSavedViewApplication(tab, view);

		expect(result.nextTab).toBeNull();
		expect(result.error).toContain("newer version");
	});
});
