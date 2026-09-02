import { afterEach, beforeEach, describe, expect, mock, test } from "bun:test";
import { GlobalRegistrator } from "@happy-dom/global-registrator";

if (!globalThis.document) GlobalRegistrator.register();

type TestEvent = Record<string, unknown>;

const channels: Array<{ onmessage: (payload: TestEvent) => void }> = [];
class TestChannel {
	onmessage = (_payload: TestEvent) => undefined;

	constructor() {
		channels.push(this);
	}
}

const tauriCore = await import("@tauri-apps/api/core");
mock.module("@tauri-apps/api/core", () => ({ ...tauriCore, Channel: TestChannel }));

let resolveStart: (value: { streamId: string }) => void;
let stopCalls: string[] = [];
mock.module("@/lib/logs", () => ({
	appendToLogBuffer: (
		current: Array<Record<string, unknown>>,
		incoming: Record<string, unknown> | Array<Record<string, unknown>>,
	) => current.concat(incoming),
	filterLogEntries: (entries: Array<Record<string, unknown>>) => entries,
	getObservabilityCapabilities: async () => [],
	normalizeObservabilityEvent: (event: TestEvent) => event,
	startObservabilityStream: () =>
		new Promise<{ streamId: string }>((resolve) => {
			resolveStart = resolve;
		}),
	stopObservabilityStream: async (streamId: string) => {
		stopCalls.push(streamId);
	},
}));

const { act, cleanup, renderHook } = await import("@testing-library/react");
const { useObservabilityStream } = await import("./useObservabilityStream");

const options = {
	connectionUuid: "connection-1",
	mode: "logs" as const,
	source: "docker",
	enabled: true,
};

beforeEach(() => {
	channels.length = 0;
	stopCalls = [];
});

afterEach(() => cleanup());

describe("useObservabilityStream terminal event ownership", () => {
	test("does not overwrite error and stopped events when start resolves late", async () => {
		const { result } = renderHook(() => useObservabilityStream(options));
		const channel = channels[0];

		act(() => {
			channel.onmessage({
				type: "error",
				streamId: "stream-1",
				code: "SOURCE_FAILED",
				message: "Source failed",
				recoverable: false,
			});
			channel.onmessage({
				type: "stopped",
				streamId: "stream-1",
				reason: "source-ended",
			});
		});

		await act(async () => {
			resolveStart({ streamId: "stream-1" });
			await Promise.resolve();
		});

		expect(result.current.status).toBe("stopped");
		expect(result.current.error).toBe("Source failed");
	});

	test("keeps buffered entries when the current stream stops", async () => {
		const { result } = renderHook(() => useObservabilityStream(options));
		const channel = channels[0];

		act(() => {
			channel.onmessage({
				type: "snapshot",
				streamId: "stream-1",
				entries: [
					{
						id: "diagnostic-line",
						kind: "line",
						raw: "ERROR source failed",
						timestamp: null,
						level: "error",
						message: "source failed",
						context: null,
					},
				],
			});
		});
		await act(
			() =>
				new Promise<void>((resolve) => {
					requestAnimationFrame(() => resolve());
				}),
		);

		act(() => {
			channel.onmessage({
				type: "stopped",
				streamId: "stream-1",
				reason: "source-ended",
			});
		});

		expect(result.current.status).toBe("stopped");
		expect(result.current.entries.map((entry) => entry.id)).toEqual([
			"diagnostic-line",
		]);
	});

	test("stops a stream that resolves after the hook unmounts", async () => {
		const { unmount } = renderHook(() => useObservabilityStream(options));
		unmount();

		await act(async () => {
			resolveStart({ streamId: "late-stream" });
			await Promise.resolve();
		});

		expect(stopCalls).toEqual(["late-stream"]);
	});

	test("clears the retained entry array when the source changes", async () => {
		const { result, rerender } = renderHook(
			({ source }: { source: string }) =>
				useObservabilityStream({ ...options, source }),
			{ initialProps: { source: "docker" } },
		);

		act(() => {
			channels[0].onmessage({
				type: "snapshot",
				streamId: "stream-1",
				entries: [
					{
						id: "line-1",
						kind: "line",
						raw: "INFO ready",
						timestamp: null,
						level: "info",
						message: "ready",
						context: null,
					},
				],
			});
		});
		await act(
			() =>
				new Promise<void>((resolve) => {
					requestAnimationFrame(() => resolve());
				}),
		);
		expect(result.current.entries).toHaveLength(1);

		rerender({ source: "server-log" });
		expect(result.current.entries).toEqual([]);
		rerender({ source: "docker" });
		expect(result.current.entries).toEqual([]);
	});

	test("coalesces burst snapshots until the next animation frame", async () => {
		const { result } = renderHook(() => useObservabilityStream(options));
		const entry = (id: string) => ({
			id,
			kind: "line",
			raw: `INFO ${id}`,
			timestamp: null,
			level: "info",
			message: id,
			context: null,
		});

		act(() => {
			channels[0].onmessage({
				type: "snapshot",
				streamId: "stream-1",
				entries: [entry("line-1")],
			});
			channels[0].onmessage({
				type: "snapshot",
				streamId: "stream-1",
				entries: [entry("line-2")],
			});
		});
		expect(result.current.entries).toEqual([]);

		await act(
			() =>
				new Promise<void>((resolve) => {
					requestAnimationFrame(() => resolve());
				}),
		);
		expect(result.current.entries.map((item) => item.id)).toEqual([
			"line-1",
			"line-2",
		]);
	});

	test("cancels a queued snapshot when the local buffer is cleared", async () => {
		const { result } = renderHook(() => useObservabilityStream(options));
		act(() => {
			channels[0].onmessage({
				type: "snapshot",
				streamId: "stream-1",
				entries: [
					{
						id: "queued-line",
						kind: "line",
						raw: "INFO queued",
						timestamp: null,
						level: "info",
						message: "queued",
						context: null,
					},
				],
			});
			result.current.clear();
		});

		await act(
			() =>
				new Promise<void>((resolve) => {
					requestAnimationFrame(() => resolve());
				}),
		);
		expect(result.current.entries).toEqual([]);
	});

	test("keeps only the newest Activity snapshot delivered in one frame", async () => {
		const activityOptions = { ...options, mode: "activity" as const };
		const { result } = renderHook(() =>
			useObservabilityStream(activityOptions),
		);
		const activity = (id: string) => ({
			id,
			kind: "activity",
			raw: id,
			timestamp: null,
			level: "info",
			message: id,
			context: null,
		});

		act(() => {
			channels[0].onmessage({
				type: "snapshot",
				streamId: "stream-1",
				entries: [activity("old-1"), activity("old-2")],
			});
			channels[0].onmessage({
				type: "snapshot",
				streamId: "stream-1",
				entries: [activity("current")],
			});
		});
		await act(
			() =>
				new Promise<void>((resolve) => {
					requestAnimationFrame(() => resolve());
				}),
		);

		expect(result.current.entries.map((item) => item.id)).toEqual(["current"]);
	});

	test("stops the previous stream when its source changes", async () => {
		const { rerender } = renderHook(
			({ source }: { source: string }) =>
				useObservabilityStream({ ...options, source }),
			{ initialProps: { source: "docker" } },
		);
		await act(async () => {
			resolveStart({ streamId: "docker-stream" });
			await Promise.resolve();
		});

		rerender({ source: "server-log" });

		expect(stopCalls).toContain("docker-stream");
	});
});
