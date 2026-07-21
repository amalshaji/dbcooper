import { describe, expect, test } from "bun:test";
import { aiDraftReducer, initialAiDraftState } from "./aiDraftState";

describe("aiDraftReducer", () => {
	test("moves a streamed request from loading to a ready draft", () => {
		const generating = aiDraftReducer(initialAiDraftState, { type: "start" });
		const streaming = aiDraftReducer(generating, {
			type: "preview",
			sql: "SELECT *",
		});
		const ready = aiDraftReducer(streaming, {
			type: "complete",
			sql: "SELECT * FROM users",
		});

		expect(generating).toEqual({ status: "generating", sql: "" });
		expect(streaming).toEqual({ status: "generating", sql: "SELECT *" });
		expect(ready).toEqual({ status: "ready", sql: "SELECT * FROM users" });
	});

	test("shows a terminal error instead of leaving an empty loading draft", () => {
		const generating = aiDraftReducer(initialAiDraftState, { type: "start" });
		const failed = aiDraftReducer(generating, {
			type: "fail",
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
				{ status: "generating", sql: "" },
				{ type: "complete", sql: "" },
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
			aiDraftReducer(failed, { type: "preview", sql: "SELECT 1" }),
		).toEqual(failed);
	});

	test("returns to idle when the draft is discarded", () => {
		expect(
			aiDraftReducer({ status: "ready", sql: "SELECT 1" }, { type: "discard" }),
		).toEqual(initialAiDraftState);
	});
});
