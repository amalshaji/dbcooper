import { describe, expect, test } from "bun:test";
import { loadSettingsFormData } from "./settingsFormData";

describe("loadSettingsFormData", () => {
	test("keeps saved settings when optional harness discovery fails", async () => {
		const result = loadSettingsFormData(
			async () => ({ update_channel: "canary" }),
			async () => {
				throw new Error("harness discovery failed");
			},
		);

		expect((await result.settings).update_channel).toBe("canary");
		expect(await result.harnesses).toEqual([]);
	});

	test("makes settings available without waiting for harness discovery", async () => {
		const result = loadSettingsFormData(
			async () => ({ update_channel: "canary" }),
			() => new Promise<never>(() => {}),
		);

		expect((await result.settings).update_channel).toBe("canary");
	});

	test("rejects when settings cannot be loaded", async () => {
		const result = loadSettingsFormData(
			async () => {
				throw new Error("settings unavailable");
			},
			async () => [],
		);

		await expect(
			result.settings,
		).rejects.toThrow("settings unavailable");
	});
});
