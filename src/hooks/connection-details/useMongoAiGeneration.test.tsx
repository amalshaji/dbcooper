import { afterEach, expect, mock, test } from "bun:test";
import { GlobalRegistrator } from "@happy-dom/global-registrator";
import type { MongoWorkbenchController } from "./useMongoWorkbench";

if (!globalThis.document) GlobalRegistrator.register();

const generationCalls: Array<{ dbType: string; existingQuery: string }> = [];
const generatedQuery = JSON.stringify({
	version: 1,
	type: "find",
	database: "app",
	collection: "users",
	filter: { active: true },
	projection: {},
	sort: {},
	limit: 100,
});

mock.module("../useAIGeneration", () => ({
	useAIGeneration: () => ({
		isConfigured: true,
		cancelGeneration: () => undefined,
		generateSQL: async (
			_requestKey: string,
			dbType: string,
			_instruction: string,
			existingQuery: string,
			_tables: unknown[],
			onStream: (chunk: string) => void,
			onComplete: (query: string) => void,
		) => {
			generationCalls.push({ dbType, existingQuery });
			onStream(generatedQuery);
			onComplete(generatedQuery);
		},
	}),
}));

const { act, cleanup, renderHook } = await import("@testing-library/react");
const { useMongoAiGeneration } = await import("./useMongoAiGeneration");

afterEach(() => {
	cleanup();
	generationCalls.length = 0;
});

test("generates a MongoDB draft and loads it only after explicit approval", async () => {
	const loadedQueries: string[] = [];
	const workbench = {
		editor: { type: "find", filter: "{}", projection: "{}", sort: "{}" },
		namespace: { database: "app", collection: "users" },
		catalog: [
			{
				name: "app",
				collections: [{ database: "app", name: "users" }],
			},
		],
		actions: { loadQuery: (query: string) => loadedQueries.push(query) },
	} as unknown as MongoWorkbenchController;
	const { result } = renderHook(() =>
		useMongoAiGeneration("connection-1", workbench),
	);

	act(() => result.current.setInstruction("Find active users"));
	await act(async () => result.current.generate());

	expect(generationCalls).toHaveLength(1);
	expect(generationCalls[0].dbType).toBe("mongodb");
	expect(JSON.parse(generationCalls[0].existingQuery)).toMatchObject({
		version: 1,
		type: "find",
		database: "app",
		collection: "users",
	});
	expect(result.current.state.draft.status).toBe("ready");
	expect(loadedQueries).toHaveLength(0);

	act(() => result.current.useDraft());

	expect(loadedQueries).toEqual([generatedQuery]);
	expect(result.current.state.draft.status).toBe("idle");
});

test("generates from a clean baseline when the current MongoDB editor is invalid", async () => {
	const workbench = {
		editor: {
			type: "find",
			filter: '{ name: "Amal"',
			projection: "{}",
			sort: "{}",
		},
		namespace: { database: "app", collection: "users" },
		catalog: [
			{
				name: "app",
				collections: [{ database: "app", name: "users" }],
			},
		],
		actions: { loadQuery: () => undefined },
	} as unknown as MongoWorkbenchController;
	const { result } = renderHook(() =>
		useMongoAiGeneration("connection-1", workbench),
	);

	act(() => result.current.setInstruction('Search for names "Amal"'));
	await act(async () => result.current.generate());

	expect(generationCalls).toHaveLength(1);
	expect(JSON.parse(generationCalls[0].existingQuery)).toEqual({
		version: 1,
		type: "find",
		database: "app",
		collection: "users",
		filter: {},
		projection: {},
		sort: {},
		limit: 100,
	});
	expect(result.current.state.draft.status).toBe("ready");
});
