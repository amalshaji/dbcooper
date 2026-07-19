import { describe, expect, test } from "bun:test";
import { resolveUpdateChannel } from "./updateChannel";

describe("resolveUpdateChannel", () => {
	test("keeps canary updates opt-in", () => {
		expect(resolveUpdateChannel("canary")).toBe("canary");
	});

	test("defaults missing and unsupported values to stable", () => {
		expect(resolveUpdateChannel(undefined)).toBe("stable");
		expect(resolveUpdateChannel(null)).toBe("stable");
		expect(resolveUpdateChannel("nightly")).toBe("stable");
	});
});
