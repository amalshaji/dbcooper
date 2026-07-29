import { describe, expect, test } from "bun:test";
import {
	aiDraftReducer,
	createQueryAiState,
	initialAiDraftState,
	queryAiStateReducer,
} from "./aiDraftState";

describe("aiDraftReducer", () => {
	test("preserves the original SQL while a streamed draft changes", () => {
		const target = { from: 7, to: 9, text: "id" };
		const generating = aiDraftReducer(initialAiDraftState, {
			type: "start",
			requestId: "request-1",
			originalSql: "SELECT id FROM users",
			target,
		});
		const streaming = aiDraftReducer(generating, {
			type: "preview",
			requestId: "request-1",
			sql: "SELECT id, name",
		});
		const ready = aiDraftReducer(streaming, {
			type: "complete",
			requestId: "request-1",
			sql: "SELECT id, name FROM users",
		});

		expect(generating).toMatchObject({
			originalSql: "SELECT id FROM users",
			target,
		});
		expect(streaming).toMatchObject({
			originalSql: "SELECT id FROM users",
			target,
		});
		expect(ready).toMatchObject({
			originalSql: "SELECT id FROM users",
			target,
		});
	});

	test("moves a streamed request from loading to a ready draft", () => {
		const generating = aiDraftReducer(initialAiDraftState, {
			type: "start",
			requestId: "request-1",
			originalSql: "",
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
			originalSql: "",
			sql: "",
		});
		expect(streaming).toEqual({
			status: "generating",
			requestId: "request-1",
			originalSql: "",
			sql: "SELECT *",
		});
		expect(ready).toEqual({
			status: "ready",
			originalSql: "",
			sql: "SELECT * FROM users",
		});
	});

	test("shows a terminal error instead of leaving an empty loading draft", () => {
		const generating = aiDraftReducer(initialAiDraftState, {
			type: "start",
			requestId: "request-1",
			originalSql: "",
		});
		const failed = aiDraftReducer(generating, {
			type: "fail",
			requestId: "request-1",
			message: "Provider unavailable",
		});

		expect(failed).toEqual({
			status: "error",
			message: "Provider unavailable",
		});
	});

	test("rejects an empty completed response", () => {
		expect(
			aiDraftReducer(
				{
					status: "generating",
					requestId: "request-1",
					originalSql: "",
					sql: "",
				},
				{ type: "complete", requestId: "request-1", sql: "" },
			),
		).toEqual({
			status: "error",
			message: "The AI provider returned an empty response",
		});
	});

	test("ignores late stream events after a request settles", () => {
		const failed = {
			status: "error" as const,
			message: "Cancelled",
		};

		expect(
			aiDraftReducer(failed, {
				type: "preview",
				requestId: "request-1",
				sql: "SELECT 1",
			}),
		).toEqual(failed);
	});

	test("returns to idle when the draft is discarded", () => {
		expect(
			aiDraftReducer(
				{ status: "ready", originalSql: "", sql: "SELECT 1" },
				{ type: "discard" },
			),
		).toEqual(initialAiDraftState);
	});

	test("allows a completed draft to be edited without changing stream state", () => {
		expect(
			aiDraftReducer(
				{
					status: "ready",
					originalSql: "SELECT * FROM users",
					sql: "SELECT * FROM users",
				},
				{ type: "edit", sql: "SELECT id FROM users" },
			),
		).toEqual({
			status: "ready",
			originalSql: "SELECT * FROM users",
			sql: "SELECT id FROM users",
		});

		const generating = {
			status: "generating" as const,
			requestId: "request-1",
			originalSql: "SELECT * FROM users",
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
			action: {
				type: "start",
				requestId: "request-1",
				originalSql: "SELECT id FROM users",
			},
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
				originalSql: "SELECT id FROM users",
				sql: "SELECT * FROM users WHERE active = true",
			},
		});
		expect(second).toEqual({ instruction: "", draft: initialAiDraftState });
	});

	test("ignores stale outcomes after a request is replaced", () => {
		let state = createQueryAiState();
		state = queryAiStateReducer(state, {
			type: "update-draft",
			action: { type: "start", requestId: "request-1", originalSql: "" },
		});
		state = queryAiStateReducer(state, {
			type: "update-draft",
			action: { type: "start", requestId: "request-2", originalSql: "" },
		});
		state = queryAiStateReducer(state, {
			type: "update-draft",
			action: {
				type: "fail",
				requestId: "request-1",
				message: "A newer AI request replaced this one",
			},
		});

		expect(state.draft).toEqual({
			status: "generating",
			requestId: "request-2",
			originalSql: "",
			sql: "",
		});

		state = queryAiStateReducer(state, {
			type: "update-draft",
			action: {
				type: "complete",
				requestId: "request-2",
				sql: "SELECT 2",
			},
		});
		expect(state.draft).toEqual({
			status: "ready",
			originalSql: "",
			sql: "SELECT 2",
		});
	});
});
