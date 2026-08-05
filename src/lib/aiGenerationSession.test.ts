import { describe, expect, test } from "bun:test";
import {
	type AiGenerationEvent,
	type AiGenerationListener,
	AiGenerationCancellationError,
	AiGenerationSessionRegistry,
	isAiGenerationCancellation,
	startAiGenerationSession,
} from "./aiGenerationSession";

describe("AiGenerationSessionRegistry", () => {
	test("replaces requests only within the same query tab", () => {
		const registry = new AiGenerationSessionRegistry();
		const cancellations: string[] = [];
		const firstTabRequest = {
			promise: Promise.resolve(),
			cancel: () => cancellations.push("first-tab-old"),
		};
		const secondTabRequest = {
			promise: Promise.resolve(),
			cancel: () => cancellations.push("second-tab"),
		};
		const replacement = {
			promise: Promise.resolve(),
			cancel: () => cancellations.push("first-tab-new"),
		};

		registry.replace("query-1", firstTabRequest);
		registry.replace("query-2", secondTabRequest);
		registry.replace("query-1", replacement);

		expect(cancellations).toEqual(["first-tab-old"]);
		expect(registry.isCurrent("query-1", replacement)).toBe(true);
		expect(registry.isCurrent("query-2", secondTabRequest)).toBe(true);

		registry.cancel("query-2");
		expect(cancellations).toEqual(["first-tab-old", "second-tab"]);
		expect(registry.isCurrent("query-1", replacement)).toBe(true);
	});

	test("uses typed reasons when requests are replaced or cancelled", () => {
		const registry = new AiGenerationSessionRegistry();
		const cancellations: unknown[] = [];
		const session = () => ({
			promise: Promise.resolve(),
			cancel: (error: Error) => cancellations.push(error),
		});

		registry.replace("query-1", session());
		registry.replace("query-1", session());
		registry.replace("query-2", session());
		registry.cancel("query-2");

		expect(cancellations).toHaveLength(2);
		expect(cancellations[0]).toBeInstanceOf(AiGenerationCancellationError);
		expect(cancellations[1]).toBeInstanceOf(AiGenerationCancellationError);
		expect(isAiGenerationCancellation(cancellations[0])).toBe(true);
		expect(isAiGenerationCancellation(cancellations[1])).toBe(true);
		if (!(cancellations[0] instanceof AiGenerationCancellationError)) return;
		if (!(cancellations[1] instanceof AiGenerationCancellationError)) return;
		expect(cancellations[0].reason).toBe("replaced");
		expect(cancellations[1].reason).toBe("cancelled");
	});
});

describe("startAiGenerationSession", () => {
	test("streams only matching events and cleans up every listener", async () => {
		const handlers = new Map<string, AiGenerationListener<unknown>>();
		let cleanupCount = 0;
		const chunks: string[] = [];
		let completed = "";
		let invokedCommand = "";

		const request = startAiGenerationSession({
			sessionId: "current",
			listen: async (eventName, handler) => {
				handlers.set(eventName, handler as AiGenerationListener<unknown>);
				return () => cleanupCount++;
			},
			invoke: async (command) => {
				invokedCommand = command;
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
		expect(invokedCommand).toBe("generate_query");
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
