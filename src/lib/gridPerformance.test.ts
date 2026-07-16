import { describe, expect, test } from "bun:test";
import { shouldVirtualizeRows } from "./gridPerformance";

describe("shouldVirtualizeRows", () => {
	test("virtualizes a requested result window once it exceeds the visible grid", () => {
		expect(shouldVirtualizeRows(true, 100)).toBe(true);
		expect(shouldVirtualizeRows(true, 20)).toBe(false);
	});

	test("respects callers that opt out", () => {
		expect(shouldVirtualizeRows(false, 100)).toBe(false);
	});
});
