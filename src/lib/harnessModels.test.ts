import { describe, expect, test } from "bun:test";
import type { AiHarnessModelCatalog } from "@/lib/tauri";
import {
	effortForModel,
	filterHarnessModels,
	harnessEfforts,
	readHarnessSelections,
	serializeHarnessSelections,
} from "./harnessModels";

const catalog: AiHarnessModelCatalog = {
	provider: "opencode_cli",
	models: [
		{
			id: "opencode/claude-opus",
			name: "Claude Opus",
			efforts: ["low", "high", "max"],
			default_effort: null,
		},
		{
			id: "opencode/gemini-flash",
			name: "Gemini Flash",
			efforts: ["minimal", "low"],
			default_effort: null,
		},
		{ id: "opencode/plain", name: "Plain", efforts: [], default_effort: null },
	],
	efforts: ["low", "high", "max", "minimal"],
	error: null,
};

describe("harness selections", () => {
	test("round-trip per-provider settings keys", () => {
		const selections = readHarnessSelections({
			codex_cli_model: "gpt-a",
			codex_cli_effort: "high",
		});
		expect(selections.codex_cli).toEqual({ model: "gpt-a", effort: "high" });
		expect(selections.claude_code).toEqual({ model: "", effort: "" });

		selections.claude_code = { model: " opus ", effort: "" };
		expect(serializeHarnessSelections(selections)).toEqual({
			claude_code_model: "opus",
			claude_code_effort: "",
			codex_cli_model: "gpt-a",
			codex_cli_effort: "high",
			opencode_cli_model: "",
			opencode_cli_effort: "",
		});
	});
});

describe("filterHarnessModels", () => {
	test("filters by id or name and lists everything for an exact id", () => {
		expect(filterHarnessModels(catalog.models, "gemini").map((m) => m.id)).toEqual(
			["opencode/gemini-flash"],
		);
		expect(filterHarnessModels(catalog.models, "claude opus")).toHaveLength(1);
		expect(filterHarnessModels(catalog.models, "opencode/plain")).toHaveLength(3);
		expect(filterHarnessModels(catalog.models, "")).toHaveLength(3);
	});
});

describe("thinking levels", () => {
	test("use the model's levels, falling back to the catalog", () => {
		expect(harnessEfforts(catalog, "opencode/gemini-flash")).toEqual([
			"minimal",
			"low",
		]);
		expect(harnessEfforts(catalog, "opencode/plain")).toEqual(catalog.efforts);
		expect(harnessEfforts(catalog, "custom/model")).toEqual(catalog.efforts);
		expect(harnessEfforts(null, "any")).toEqual([]);
	});

	test("reset an unsupported level when the model changes", () => {
		expect(effortForModel(catalog, "opencode/gemini-flash", "max")).toBe("");
		expect(effortForModel(catalog, "opencode/claude-opus", "max")).toBe("max");
		expect(effortForModel(null, "custom", "max")).toBe("max");
	});
});
