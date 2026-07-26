import { afterEach, beforeEach, expect, mock, test } from "bun:test";
import { GlobalRegistrator } from "@happy-dom/global-registrator";
import { useState } from "react";
import { AiGenerationCancellationError } from "../lib/aiGenerationSession";
import type { QueryTab, Tab, TableDataTab } from "../types/tabTypes";

if (!globalThis.document) GlobalRegistrator.register();

interface ToastOptions {
	description?: string;
	action?: { label: string; onClick: () => void };
}

const successToasts: Array<{ title: string; options?: ToastOptions }> = [];
const errorToasts: Array<{ title: string; options?: ToastOptions }> = [];

mock.module("sonner", () => ({
	toast: {
		success: (title: string, options?: ToastOptions) =>
			successToasts.push({ title, options }),
		error: (title: string, options?: ToastOptions) =>
			errorToasts.push({ title, options }),
	},
}));

const { act, cleanup, renderHook } = await import("@testing-library/react");
const { useQueryAiGeneration } = await import("./useQueryAiGeneration");

beforeEach(() => {
	successToasts.length = 0;
	errorToasts.length = 0;
});

afterEach(cleanup);

function createQuery(): QueryTab {
	return {
		id: "query-1",
		type: "query",
		title: "Active users",
		query: "SELECT * FROM users",
		ai: { instruction: "List active users", draft: { status: "idle" } },
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

function createTable(): TableDataTab {
	return {
		id: "table-1",
		type: "table-data",
		title: "users",
		tableName: "public.users",
		data: null,
		currentPage: 1,
		loading: false,
		filterState: {
			draft: { kind: "advanced", value: "" },
			applied: { kind: "advanced", value: "" },
		},
		foreignKeys: [],
		columns: [],
		sort: null,
		columnLayout: {
			columnOrder: [],
			hiddenColumns: [],
			columnWidths: {},
		},
		savedViewId: null,
	};
}

test("preserves a completed background draft and navigates to it from the toast", async () => {
	const queryTab = createQuery();
	const tableTab = createTable();

	let previewDraft: ((sql: string) => void) | undefined;
	let resolveDraft: ((sql: string) => void) | undefined;
	const generateDraft = (
		_requestKey: string,
		_instruction: string,
		_existingSQL: string,
		onPreview: (sql: string) => void,
	) => {
		previewDraft = onPreview;
		return new Promise<string>((resolve) => {
			resolveDraft = resolve;
		});
	};
	const { result } = renderHook(() => {
		const [tabs, setTabs] = useState<Tab[]>([queryTab, tableTab]);
		const [activeTabId, setActiveTabId] = useState<string | null>(tableTab.id);
		const queryAi = useQueryAiGeneration({
			tabs,
			activeTabId,
			setTabs,
			setActiveTabId,
			generateDraft,
			cancelGeneration: () => undefined,
			isConfigured: true,
		});
		return { tabs, activeTabId, queryAi };
	});

	let generation: Promise<void> | undefined;
	act(() => {
		const tab = result.current.tabs[0];
		if (tab?.type !== "query") throw new Error("Expected the first tab to be a query");
		generation = result.current.queryAi.getEditorAiProps(tab).onGenerate();
	});
	expect(result.current.tabs[0]).toMatchObject({
		type: "query",
		ai: { draft: { status: "generating", sql: "" } },
	});

	act(() => previewDraft?.("SELECT *"));
	expect(result.current.tabs[0]).toMatchObject({
		type: "query",
		ai: { draft: { status: "generating", sql: "SELECT *" } },
	});

	await act(async () => {
		resolveDraft?.("SELECT * FROM users WHERE active = true");
		await generation;
	});
	expect(result.current.tabs[0]).toMatchObject({
		type: "query",
		ai: {
			draft: {
				status: "ready",
				sql: "SELECT * FROM users WHERE active = true",
			},
		},
	});
	expect(successToasts).toHaveLength(1);
	expect(successToasts[0]?.title).toBe("AI query ready");
	expect(successToasts[0]?.options?.action?.label).toBe("View query");
	expect(errorToasts).toHaveLength(0);

	const viewQuery = successToasts[0]?.options?.action?.onClick;
	if (!viewQuery) throw new Error("Expected the toast to include a View query action");
	act(viewQuery);
	expect(result.current.activeTabId).toBe(queryTab.id);
});

test("does not treat the untouched starter query as AI context", async () => {
	const queryTab = createQuery();
	queryTab.query = "SELECT * FROM ";
	queryTab.ai.instruction = "Create an events table";
	let existingSql: string | undefined;

	const { result } = renderHook(() => {
		const [tabs, setTabs] = useState<Tab[]>([queryTab]);
		const [activeTabId, setActiveTabId] = useState<string | null>(queryTab.id);
		const queryAi = useQueryAiGeneration({
			tabs,
			activeTabId,
			setTabs,
			setActiveTabId,
			generateDraft: async (_requestKey, _instruction, currentSql) => {
				existingSql = currentSql;
				return "CREATE TABLE events(id INTEGER);";
			},
			cancelGeneration: () => undefined,
			isConfigured: true,
		});
		return { tabs, queryAi };
	});

	await act(async () => {
		const tab = result.current.tabs[0];
		if (tab?.type !== "query") throw new Error("Expected a query tab");
		await result.current.queryAi.getEditorAiProps(tab).onGenerate();
	});

	expect(existingSql).toBe("");
});

test("cancels a generating tab without leaving state or showing a toast", async () => {
	const queryTab = createQuery();
	const tableTab = createTable();
	let rejectDraft: ((error: Error) => void) | undefined;

	const { result } = renderHook(() => {
		const [tabs, setTabs] = useState<Tab[]>([queryTab, tableTab]);
		const [activeTabId, setActiveTabId] = useState<string | null>(tableTab.id);
		const queryAi = useQueryAiGeneration({
			tabs,
			activeTabId,
			setTabs,
			setActiveTabId,
			generateDraft: () =>
				new Promise<string>((_resolve, reject) => {
					rejectDraft = reject;
				}),
			cancelGeneration: () =>
				rejectDraft?.(new AiGenerationCancellationError("cancelled")),
			isConfigured: true,
		});
		const closeTab = (tabId: string) => {
			queryAi.cancelTabGeneration(tabId);
			setTabs((currentTabs) =>
				currentTabs.filter((tab) => tab.id !== tabId),
			);
		};
		return { tabs, queryAi, closeTab };
	});

	let generation: Promise<void> | undefined;
	act(() => {
		const tab = result.current.tabs[0];
		if (tab?.type !== "query") throw new Error("Expected the first tab to be a query");
		generation = result.current.queryAi.getEditorAiProps(tab).onGenerate();
	});

	await act(async () => {
		result.current.closeTab(queryTab.id);
		await generation;
	});
	expect(result.current.tabs.map((tab) => tab.id)).toEqual([tableTab.id]);
	expect(successToasts).toHaveLength(0);
	expect(errorToasts).toHaveLength(0);
});
