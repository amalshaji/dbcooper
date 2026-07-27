import { afterEach, beforeEach, expect, mock, test } from "bun:test";
import { GlobalRegistrator } from "@happy-dom/global-registrator";
import { useCallback, useState } from "react";
import type { SqlConnection } from "../../types/connection";
import type { Tab, TableDataTab } from "../../types/tabTypes";
import type { TableDataResponse } from "../../types/tableData";

if (!globalThis.document) GlobalRegistrator.register();

function deferred<T>() {
	let resolve: (value: T) => void = () => {};
	const promise = new Promise<T>((complete) => {
		resolve = complete;
	});
	return { promise, resolve };
}

let tableDataResult = deferred<TableDataResponse>();

mock.module("sonner", () => ({
	toast: {
		error: () => {},
		info: () => {},
		success: () => {},
	},
}));

mock.module("../useSavedViewApplication", () => ({
	useSavedViewApplication: () => async () => true,
}));

mock.module("../useTableDataFilters", () => ({
	useTableDataFilters: () => ({
		setFilterState: () => {},
		applyFilter: () => {},
		clearFilter: () => {},
		filterCell: () => {},
	}),
}));

mock.module("../../lib/tauri", () => ({
	api: {
		pool: {
			getTableData: () => tableDataResult.promise,
		},
	},
}));

const { act, cleanup, renderHook } = await import("@testing-library/react");
const { useTableDataController } = await import("./useTableDataController");

beforeEach(() => {
	tableDataResult = deferred<TableDataResponse>();
});

afterEach(cleanup);

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

function tableTab(id: string, tableName: string): TableDataTab {
	return {
		id,
		type: "table-data",
		title: tableName,
		tableName,
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
		columns: [
			{
				name: "id",
				type: "integer",
				filter_kind: "integer",
				nullable: false,
				default: null,
				primary_key: true,
			},
			{
				name: "name",
				type: "text",
				filter_kind: "text",
				nullable: false,
				default: null,
				primary_key: false,
			},
		],
		sort: null,
		columnLayout: {
			columnOrder: ["id", "name"],
			hiddenColumns: [],
			columnWidths: {},
		},
		savedViewId: null,
	};
}

function renderController() {
	const first = tableTab("table-1", "public.users");
	const second = tableTab("table-2", "public.teams");
	return renderHook(() => {
		const [tabs, setTabs] = useState<Tab[]>([first, second]);
		const [activeTabId, setActiveTabId] = useState(first.id);
		const activeTab = tabs.find((tab) => tab.id === activeTabId) ?? null;
		const activeTableDataTab =
			activeTab?.type === "table-data" ? activeTab : null;
		const updateTableDataTab = useCallback(
			(tabId: string, changes: Partial<Omit<TableDataTab, "id" | "type">>) => {
				setTabs((currentTabs) =>
					currentTabs.map((tab) =>
						tab.id === tabId && tab.type === "table-data"
							? { ...tab, ...changes }
							: tab,
					),
				);
			},
			[],
		);
		const controller = useTableDataController({
			connection,
			activeTab: activeTableDataTab,
			updateTableDataTab,
		});
		return { tabs, controller, selectTab: setActiveTabId };
	});
}

test("finishes loading data on its originating tab after switching tabs", async () => {
	const { result } = renderController();

	let request: Promise<void> | undefined;
	act(() => {
		request = result.current.controller.fetchTableData(
			result.current.tabs[0] as TableDataTab,
		);
	});
	act(() => result.current.selectTab("table-2"));

	await act(async () => {
		tableDataResult.resolve({
			data: [{ id: 1, name: "Ada" }],
			total: 1,
			page: 1,
			limit: 100,
		});
		await request;
	});

	expect(result.current.tabs[0]).toMatchObject({
		id: "table-1",
		data: { data: [{ id: 1, name: "Ada" }] },
		loading: false,
	});
	expect(result.current.tabs[1]).toMatchObject({ id: "table-2", data: null });
});

test("keeps staged inline edits isolated by tab", async () => {
	const { result } = renderController();

	await act(async () => {
		await result.current.controller.workspace.data.stageCellEdit(
			{ id: 1, name: "Ada" },
			"name",
			"Grace",
		);
	});
	act(() => result.current.selectTab("table-2"));
	await act(async () => {
		await result.current.controller.workspace.data.stageCellEdit(
			{ id: 2, name: "Compiler" },
			"name",
			"Runtime",
		);
	});

	expect(
		Object.keys(result.current.controller.workspace.inlineEdits.byTab),
	).toEqual(["table-1", "table-2"]);
	expect(
		Object.values(
			result.current.controller.workspace.inlineEdits.byTab["table-1"],
		)[0],
	).toMatchObject({ value: "Grace" });
	expect(
		Object.values(
			result.current.controller.workspace.inlineEdits.byTab["table-2"],
		)[0],
	).toMatchObject({ value: "Runtime" });
});
