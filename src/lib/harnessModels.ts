import type {
	AiHarnessModel,
	AiHarnessModelCatalog,
	AiHarnessProvider,
} from "@/lib/tauri";

export interface HarnessSelection {
	model: string;
	effort: string;
}

export const HARNESS_PROVIDERS: AiHarnessProvider[] = [
	"claude_code",
	"codex_cli",
	"opencode_cli",
];

const MAX_LISTED_MODELS = 100;

export function harnessSettingKeys(provider: AiHarnessProvider) {
	return { model: `${provider}_model`, effort: `${provider}_effort` };
}

export function readHarnessSelections(
	settings: Record<string, string>,
): Record<AiHarnessProvider, HarnessSelection> {
	return Object.fromEntries(
		HARNESS_PROVIDERS.map((provider) => {
			const keys = harnessSettingKeys(provider);
			return [
				provider,
				{
					model: settings[keys.model] ?? "",
					effort: settings[keys.effort] ?? "",
				},
			];
		}),
	) as Record<AiHarnessProvider, HarnessSelection>;
}

export function serializeHarnessSelections(
	selections: Record<AiHarnessProvider, HarnessSelection>,
): Record<string, string> {
	return Object.fromEntries(
		HARNESS_PROVIDERS.flatMap((provider) => {
			const keys = harnessSettingKeys(provider);
			return [
				[keys.model, selections[provider].model.trim()],
				[keys.effort, selections[provider].effort.trim()],
			];
		}),
	);
}

/** Show every model once the input exactly names one, so the list stays browsable. */
export function filterHarnessModels(
	models: AiHarnessModel[],
	query: string,
): AiHarnessModel[] {
	const needle = query.trim().toLowerCase();
	const matches =
		!needle || models.some((model) => model.id.toLowerCase() === needle)
			? models
			: models.filter(
					(model) =>
						model.id.toLowerCase().includes(needle) ||
						model.name.toLowerCase().includes(needle),
				);
	return matches.slice(0, MAX_LISTED_MODELS);
}

export function harnessEfforts(
	catalog: AiHarnessModelCatalog | null,
	model: string,
): string[] {
	if (!catalog) return [];
	const selected = catalog.models.find((candidate) => candidate.id === model);
	return selected?.efforts.length ? selected.efforts : catalog.efforts;
}

/** Drop a thinking level the newly selected model does not support. */
export function effortForModel(
	catalog: AiHarnessModelCatalog | null,
	model: string,
	effort: string,
): string {
	const efforts = harnessEfforts(catalog, model);
	return effort && efforts.length > 0 && !efforts.includes(effort) ? "" : effort;
}
