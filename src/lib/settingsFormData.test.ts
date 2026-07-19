import { describe, expect, test } from "bun:test";
import { loadSettingsFormData } from "./settingsFormData";

describe("loadSettingsFormData", () => {
	test("keeps saved settings when optional harness discovery fails", async () => {
		const result = await loadSettingsFormData(
			async () => ({ update_channel: "canary" }),
			async () => {
				throw new Error("harness discovery failed");
			},
		);

		expect(result.settings.update_channel).toBe("canary");
		expect(result.harnesses).toEqual([]);
	});

	test("rejects when settings cannot be loaded", async () => {
		await expect(
			loadSettingsFormData(
				async () => {
					throw new Error("settings unavailable");
				},
				async () => [],
			),
		).rejects.toThrow("settings unavailable");
	});
});
