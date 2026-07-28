import { beforeEach, expect, mock, test } from "bun:test";

let invokeCalls = 0;
let progressListener:
	| ((event: {
			payload: {
				stage: "downloading";
				downloadedBytes: number;
				totalBytes: number;
			};
	  }) => void)
	| null = null;

mock.module("@tauri-apps/api/event", () => ({
	listen: async (
		_event: string,
		listener: typeof progressListener,
	): Promise<() => void> => {
		progressListener = listener;
		return () => undefined;
	},
}));

mock.module("@tauri-apps/api/core", () => ({
	invoke: async () => {
		invokeCalls += 1;
		progressListener?.({
			payload: {
				stage: "downloading",
				downloadedBytes: 50,
				totalBytes: 100,
			},
		});
		return { version: "1.5.5", path: "/tmp/duckdb", downloaded: true };
	},
}));

const { prepareDuckDbRuntime } = await import("./duckdbHelper");

beforeEach(() => {
	invokeCalls = 0;
	progressListener = null;
});

test("does nothing for database types without a runtime helper", async () => {
	const progress: unknown[] = [];

	await prepareDuckDbRuntime("postgres", (value) => progress.push(value));

	expect(invokeCalls).toBe(0);
	expect(progress).toEqual([]);
});

test("owns DuckDB preparation and forwards progress through one adapter", async () => {
	const progress: unknown[] = [];

	await prepareDuckDbRuntime("duckdb", (value) => progress.push(value));

	expect(invokeCalls).toBe(1);
	expect(progress).toEqual([
		{ stage: "downloading", downloadedBytes: 0, totalBytes: null },
		{ stage: "downloading", downloadedBytes: 50, totalBytes: 100 },
	]);
});
