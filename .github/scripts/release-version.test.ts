import { describe, expect, test } from "bun:test";
import { resolveReleaseVersion } from "./release-version";

describe("resolveReleaseVersion", () => {
	test.each([
		["patch", "0.0.66"],
		["minor", "0.1.0"],
		["major", "1.0.0"],
	] as const)("resolves a %s bump", (mode, expected) => {
		expect(resolveReleaseVersion("0.0.65", mode)).toBe(expected);
	});

	test("accepts a newer explicit version", () => {
		expect(resolveReleaseVersion("1.4.2", "explicit", "2.0.0")).toBe(
			"2.0.0",
		);
	});

	test.each(["", "1.4", "v1.5.0", "1.4.2", "1.3.9"])(
		"rejects invalid explicit version %s",
		(version) => {
			expect(() => resolveReleaseVersion("1.4.2", "explicit", version)).toThrow();
		},
	);
});
