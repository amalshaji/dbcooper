import { describe, expect, test } from "bun:test";
import {
	resolveUpdateChannel,
	resolveUpdateChannelEvent,
	UPDATE_CHANNEL_CHANGED_EVENT,
} from "./updateChannel";

describe("resolveUpdateChannel", () => {
	test("keeps canary updates opt-in", () => {
		expect(resolveUpdateChannel("canary")).toBe("canary");
	});

	test("defaults missing and unsupported values to stable", () => {
		expect(resolveUpdateChannel(undefined)).toBe("stable");
		expect(resolveUpdateChannel(null)).toBe("stable");
		expect(resolveUpdateChannel("nightly")).toBe("stable");
	});

	test("uses one typed event contract for cross-window channel changes", () => {
		expect(UPDATE_CHANNEL_CHANGED_EVENT).toBe("update-channel-changed");
		expect(resolveUpdateChannelEvent("canary")).toBe("canary");
		expect(resolveUpdateChannelEvent("stable")).toBe("stable");
		expect(resolveUpdateChannelEvent({ channel: "canary" })).toBe("stable");
	});
});
