import { describe, expect, test } from "bun:test";
import {
	aiDraftReducer,
	createQueryAiState,
	initialAiDraftState,
	queryAiStateReducer,
} from "./aiDraftState";

describe("aiDraftReducer", () => {
	test("moves a streamed request from loading to a ready draft", () => {
		const generating = aiDraftReducer(initialAiDraftState, {
			type: "start",
			requestId: "request-1",
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
			sql: "",
		});
		expect(streaming).toEqual({
			status: "generating",
			requestId: "request-1",
			sql: "SELECT *",
		});
		expect(ready).toEqual({ status: "ready", sql: "SELECT * FROM users" });
	});

	test("shows a terminal error instead of leaving an empty loading draft", () => {
		const generating = aiDraftReducer(initialAiDraftState, {
			type: "start",
			requestId: "request-1",
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
				{ status: "generating", requestId: "request-1", sql: "" },
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
			aiDraftReducer({ status: "ready", sql: "SELECT 1" }, { type: "discard" }),
		).toEqual(initialAiDraftState);
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
			action: { type: "start", requestId: "request-1" },
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
				sql: "SELECT * FROM users WHERE active = true",
			},
		});
		expect(second).toEqual({ instruction: "", draft: initialAiDraftState });
	});

	test("ignores stale outcomes after a request is replaced", () => {
		let state = createQueryAiState();
		state = queryAiStateReducer(state, {
			type: "update-draft",
			action: { type: "start", requestId: "request-1" },
		});
		state = queryAiStateReducer(state, {
			type: "update-draft",
			action: { type: "start", requestId: "request-2" },
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
		expect(state.draft).toEqual({ status: "ready", sql: "SELECT 2" });
	});
});
