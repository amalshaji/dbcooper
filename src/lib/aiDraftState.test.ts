import { describe, expect, test } from "bun:test";
import {
	aiDraftReducer,
	createQueryAiState,
	initialAiDraftState,
	queryAiStateReducer,
	type SqlEditScope,
} from "./aiDraftState";

const queryScope: SqlEditScope = {
	kind: "query",
	sql: "SELECT id FROM users",
};

describe("aiDraftReducer", () => {
	test("preserves the explicit edit scope while a streamed draft changes", () => {
		const scope: SqlEditScope = {
			kind: "selection",
			sql: "SELECT id FROM users",
			selection: { from: 7, to: 9, text: "id" },
		};
		const generating = aiDraftReducer(initialAiDraftState, {
			type: "start",
			requestId: "request-1",
			scope,
		});
		const streaming = aiDraftReducer(generating, {
			type: "preview",
			requestId: "request-1",
			sql: "id, name",
		});
		const ready = aiDraftReducer(streaming, {
			type: "complete",
			requestId: "request-1",
			sql: "id, name, email",
		});

		expect(generating).toMatchObject({ scope });
		expect(streaming).toMatchObject({ scope });
		expect(ready).toMatchObject({ scope });
	});

	test("moves a streamed request from loading to a ready draft", () => {
		const generating = aiDraftReducer(initialAiDraftState, {
			type: "start",
			requestId: "request-1",
			scope: queryScope,
		});
		const streaming = aiDraftReducer(generating, {
			type: "preview",
			requestId: "request-1",
			sql: "SELECT *",
		});
		const ready = aiDraftReducer(streaming, {
			type: "complete",
			requestId: "request-1",
			sql: "SELECT * FROM users",
		});

		expect(generating).toEqual({
			status: "generating",
			requestId: "request-1",
			scope: queryScope,
			sql: "",
		});
		expect(streaming).toEqual({
			status: "generating",
			requestId: "request-1",
			scope: queryScope,
			sql: "SELECT *",
		});
		expect(ready).toEqual({
			status: "ready",
			scope: queryScope,
			sql: "SELECT * FROM users",
		});
	});

	test("shows a terminal error and rejects an empty completion", () => {
		const generating = aiDraftReducer(initialAiDraftState, {
			type: "start",
			requestId: "request-1",
			scope: queryScope,
		});

		expect(
			aiDraftReducer(generating, {
				type: "fail",
				requestId: "request-1",
				message: "Provider unavailable",
			}),
		).toEqual({ status: "error", message: "Provider unavailable" });
		expect(
			aiDraftReducer(generating, {
				type: "complete",
				requestId: "request-1",
				sql: "",
			}),
		).toEqual({
			status: "error",
			message: "The AI provider returned an empty response",
		});
	});

	test("ignores stale stream events after a request settles", () => {
		const failed = { status: "error" as const, message: "Cancelled" };
		expect(
			aiDraftReducer(failed, {
				type: "preview",
				requestId: "request-1",
				sql: "SELECT 1",
			}),
		).toEqual(failed);
	});

	test("discards and edits only completed drafts", () => {
		const ready = {
			status: "ready" as const,
			scope: queryScope,
			sql: "SELECT * FROM users",
		};
		expect(aiDraftReducer(ready, { type: "discard" })).toEqual(
			initialAiDraftState,
		);
		expect(
			aiDraftReducer(ready, { type: "edit", sql: "SELECT id FROM users" }),
		).toEqual({ ...ready, sql: "SELECT id FROM users" });

		const generating = {
			status: "generating" as const,
			requestId: "request-1",
			scope: queryScope,
			sql: "SELECT *",
		};
		expect(
			aiDraftReducer(generating, { type: "edit", sql: "SELECT id" }),
		).toEqual(generating);
	});
});

describe("queryAiStateReducer", () => {
	test("keeps each query tab's prompt and draft independent", () => {
		let first = createQueryAiState();
		const second = createQueryAiState();

		first = queryAiStateReducer(first, {
			type: "set-instruction",
			instruction: "List active users",
		});
		first = queryAiStateReducer(first, {
			type: "update-draft",
			action: { type: "start", requestId: "request-1", scope: queryScope },
		});
		first = queryAiStateReducer(first, {
			type: "update-draft",
			action: {
				type: "complete",
				requestId: "request-1",
				sql: "SELECT * FROM users WHERE active = true",
			},
		});

		expect(first).toEqual({
			instruction: "List active users",
			draft: {
				status: "ready",
				scope: queryScope,
				sql: "SELECT * FROM users WHERE active = true",
			},
		});
		expect(second).toEqual({ instruction: "", draft: initialAiDraftState });
	});

	test("ignores stale outcomes after a request is replaced", () => {
		let state = createQueryAiState();
		for (const requestId of ["request-1", "request-2"]) {
			state = queryAiStateReducer(state, {
				type: "update-draft",
				action: { type: "start", requestId, scope: queryScope },
			});
		}
		state = queryAiStateReducer(state, {
			type: "update-draft",
			action: {
				type: "fail",
				requestId: "request-1",
				message: "A newer request replaced this one",
			},
		});

		expect(state.draft).toMatchObject({
			status: "generating",
			requestId: "request-2",
		});
	});
});
