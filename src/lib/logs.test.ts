import { describe, expect, test } from "bun:test";
import {
	appendToLogBuffer,
	filterLogEntries,
	normalizeObservabilityEvent,
	type LogEntry,
} from "./logs";

function entry(id: string, raw: string, level: LogEntry["level"] = "info"): LogEntry {
	return { id, kind: "line", raw, timestamp: null, level, message: raw, context: null };
}

describe("live log filtering", () => {
	const entries: LogEntry[] = [
		entry("1", "2026-08-31 10:00:00 INFO connection ready"),
		entry("2", "2026-08-31 10:00:01 ERROR timeout on analytics", "error"),
		entry("3", "2026-08-31 10:00:02 DEBUG health check", "debug"),
	];

	test("matches text case-insensitively against raw lines", () => {
		expect(filterLogEntries(entries, "ANALYTICS", new Set()).map((e) => e.id)).toEqual([
			"2",
		]);
	});

	test("applies a multi-select level filter", () => {
		expect(
			filterLogEntries(entries, "", new Set(["error", "debug"])).map(
				(entry) => entry.id,
			),
		).toEqual(["2", "3"]);
	});
});

describe("live log buffer", () => {
	test("keeps exactly the newest 2,000 entries", () => {
		const incoming = Array.from({ length: 2_005 }, (_, index) =>
			entry(String(index), `INFO line ${index}`),
		);

		const result = appendToLogBuffer([], incoming);

		expect(result).toHaveLength(2_000);
		expect(result[0]?.id).toBe("5");
		expect(result[result.length - 1]?.id).toBe("2004");
	});

	test("deduplicates overlapping snapshot entries by stable id", () => {
		const first = entry("same", "INFO first payload");
		const replacement = entry("same", "INFO corrected payload");

		expect(appendToLogBuffer([first], [replacement])).toEqual([replacement]);
	});
});

test("event normalization preserves validated backend metadata", () => {
	const raw =
		"2026-08-31T10:22:32.000000000Z 2026-08-31 10:22:31.245 UTC [4812] ERROR: relation users does not exist";
	const event = normalizeObservabilityEvent({
		type: "snapshot",
		streamId: "stream-1",
		entries: [{
			id: "line-1",
			kind: "line",
			raw,
			timestamp: "2026-08-31 10:22:31.245 UTC",
			level: "error",
			message: "relation users does not exist",
			context: "pid 4812",
		}],
	});

	expect(event).toMatchObject({
		type: "snapshot",
		entries: [{
			timestamp: "2026-08-31 10:22:31.245 UTC",
			level: "error",
			message: "relation users does not exist",
			context: "pid 4812",
		}],
	});
});

test("event normalization rejects entries with incomplete backend metadata", () => {
	const event = normalizeObservabilityEvent({
		type: "snapshot",
		streamId: "stream-1",
		entries: [{ id: "line-1", kind: "line", raw: "INFO ready" }],
	});

	expect(event).toEqual({
		type: "snapshot",
		streamId: "stream-1",
		entries: [],
	});
});
