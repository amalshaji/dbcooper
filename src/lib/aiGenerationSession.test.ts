import { describe, expect, test } from "bun:test";
import {
	type AiGenerationEvent,
	type AiGenerationListener,
	startAiGenerationSession,
} from "./aiGenerationSession";

describe("startAiGenerationSession", () => {
	test("streams only matching events and cleans up every listener", async () => {
		const handlers = new Map<string, AiGenerationListener<unknown>>();
		let cleanupCount = 0;
		const chunks: string[] = [];
		let completed = "";

		const request = startAiGenerationSession({
			sessionId: "current",
			listen: async (eventName, handler) => {
				handlers.set(eventName, handler as AiGenerationListener<unknown>);
				return () => cleanupCount++;
			},
			invoke: async () => {
				handlers.get("ai-chunk")?.({
					payload: { session_id: "other", chunk: "ignored" },
				} as AiGenerationEvent<unknown>);
				handlers.get("ai-chunk")?.({
					payload: { session_id: "current", chunk: "SELECT 1" },
				} as AiGenerationEvent<unknown>);
				handlers.get("ai-done")?.({
					payload: { session_id: "current", full_response: "SELECT 1" },
				} as AiGenerationEvent<unknown>);
			},
			invokeArgs: {},
			onChunk: (chunk) => chunks.push(chunk),
			onComplete: (sql) => {
				completed = sql;
			},
		});

		await request.promise;
		expect(chunks).toEqual(["SELECT 1"]);
		expect(completed).toBe("SELECT 1");
		expect(cleanupCount).toBe(3);
	});

	test("cancels safely while listeners are still registering", async () => {
		const registrations: Array<(unlisten: () => void) => void> = [];
		let cleanupCount = 0;
		let invokeCount = 0;
		const request = startAiGenerationSession({
			sessionId: "current",
			listen: () =>
				new Promise((resolve) => {
					registrations.push(resolve);
				}),
			invoke: async () => {
				invokeCount++;
			},
			invokeArgs: {},
			onChunk: () => undefined,
			onComplete: () => undefined,
		});

		request.cancel(new Error("Cancelled"));
		for (const register of registrations) register(() => cleanupCount++);

		await expect(request.promise).rejects.toThrow("Cancelled");
		await Promise.resolve();
		expect(invokeCount).toBe(0);
		expect(cleanupCount).toBe(3);
	});

	test("rejects provider errors and releases listeners", async () => {
		const handlers = new Map<string, AiGenerationListener<unknown>>();
		let cleanupCount = 0;
		const request = startAiGenerationSession({
			sessionId: "current",
			listen: async (eventName, handler) => {
				handlers.set(eventName, handler as AiGenerationListener<unknown>);
				return () => cleanupCount++;
			},
			invoke: async () => {
				handlers.get("ai-error")?.({
					payload: { session_id: "current", error: "Provider unavailable" },
				} as AiGenerationEvent<unknown>);
			},
			invokeArgs: {},
			onChunk: () => undefined,
			onComplete: () => undefined,
		});

		await expect(request.promise).rejects.toThrow("Provider unavailable");
		expect(cleanupCount).toBe(3);
	});
});
