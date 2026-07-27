import { describe, expect, test } from "bun:test";
import {
	formatDuckDbHelperBytes,
	getDuckDbHelperProgressView,
	initialDuckDbHelperProgress,
} from "./duckdbHelper";

describe("DuckDB helper progress", () => {
	test("reports determinate download progress", () => {
		expect(
			getDuckDbHelperProgressView({
				stage: "downloading",
				downloadedBytes: 25,
				totalBytes: 100,
			}),
		).toEqual({ label: "Downloading DuckDB support", percent: 25 });
	});

	test("uses clear labels for non-download stages", () => {
		expect(
			getDuckDbHelperProgressView({
				stage: "verifying",
				downloadedBytes: 100,
				totalBytes: 100,
			}),
		).toEqual({ label: "Verifying download", percent: 100 });
		expect(
			getDuckDbHelperProgressView({
				stage: "installing",
				downloadedBytes: 0,
				totalBytes: null,
			}),
		).toEqual({ label: "Installing DuckDB support", percent: null });
	});

	test("formats exact byte progress for display", () => {
		expect(formatDuckDbHelperBytes(12_976_128)).toBe("12.4 MB");
		expect(formatDuckDbHelperBytes(17_825_792)).toBe("17.0 MB");
	});

	test("provides an immediate state before the first backend event", () => {
		expect(initialDuckDbHelperProgress).toEqual({
			stage: "downloading",
			downloadedBytes: 0,
			totalBytes: null,
		});
	});
});
