import { useEffect, useState } from "react";
import {
	Combobox,
	ComboboxContent,
	ComboboxInput,
	ComboboxItem,
	ComboboxList,
} from "@/components/ui/combobox";
import { Label } from "@/components/ui/label";
import { Spinner } from "@/components/ui/spinner";
import {
	effortForModel,
	filterHarnessModels,
	type HarnessSelection,
	harnessEfforts,
} from "@/lib/harnessModels";
import {
	type AiHarnessModelCatalog,
	type AiHarnessProvider,
	api,
} from "@/lib/tauri";

const DEFAULT_LABEL = "CLI default";

interface HarnessModelSettingsProps {
	provider: AiHarnessProvider;
	selection: HarnessSelection;
	onChange: (selection: HarnessSelection) => void;
	compact?: boolean;
}

export function HarnessModelSettings({
	provider,
	selection,
	onChange,
	compact,
}: HarnessModelSettingsProps) {
	const [loaded, setLoaded] = useState<{
		provider: AiHarnessProvider;
		catalog: AiHarnessModelCatalog;
	} | null>(null);
	const catalog = loaded?.provider === provider ? loaded.catalog : null;
	const loading = catalog === null;

	useEffect(() => {
		let cancelled = false;
		api.ai
			.listHarnessModels(provider)
			.catch(
				(error): AiHarnessModelCatalog => ({
					provider,
					models: [],
					efforts: [],
					error: error instanceof Error ? error.message : String(error),
				}),
			)
			.then((result) => {
				if (!cancelled) setLoaded({ provider, catalog: result });
			});
		return () => {
			cancelled = true;
		};
	}, [provider]);

	const models = filterHarnessModels(catalog?.models ?? [], selection.model);
	const selectedModel = catalog?.models.find(
		(model) => model.id === selection.model,
	);
	const efforts = harnessEfforts(catalog, selection.model);
	const effortOptions =
		selection.effort && !efforts.includes(selection.effort)
			? [...efforts, selection.effort]
			: efforts;
	const labelClass = compact ? "text-sm" : "";

	const changeModel = (model: string) =>
		onChange({
			model,
			effort: effortForModel(catalog, model, selection.effort),
		});

	return (
		<>
			<div className="space-y-2">
				<Label className={labelClass}>Model</Label>
				<Combobox
					value={selection.model}
					onValueChange={(value) => value !== null && changeModel(String(value))}
				>
					<ComboboxInput
						placeholder={loading ? "Loading models…" : DEFAULT_LABEL}
						value={selection.model}
						onChange={(event) => changeModel(event.target.value)}
					/>
					<ComboboxContent>
						<ComboboxList>
							<ComboboxItem value="">{DEFAULT_LABEL}</ComboboxItem>
							{models.map((model) => (
								<ComboboxItem key={model.id} value={model.id}>
									{model.name}
								</ComboboxItem>
							))}
						</ComboboxList>
					</ComboboxContent>
				</Combobox>
				<p className="flex items-center gap-1.5 text-[0.8rem] text-muted-foreground">
					{loading ? <Spinner className="size-3" /> : null}
					{catalog?.error
						? `Couldn't list models (${catalog.error}). You can still type a model ID.`
						: "Pick a model or type any ID the CLI accepts. Leave empty to use the CLI's configured model."}
				</p>
			</div>
			<div className="space-y-2">
				<Label className={labelClass}>Thinking level</Label>
				<Combobox
					value={selection.effort}
					onValueChange={(value) =>
						value !== null &&
						onChange({ ...selection, effort: String(value) })
					}
				>
					<ComboboxInput
						value={selection.effort || DEFAULT_LABEL}
						readOnly
						disabled={effortOptions.length === 0}
					/>
					<ComboboxContent>
						<ComboboxList>
							<ComboboxItem value="">
								{selectedModel?.default_effort
									? `${DEFAULT_LABEL} (${selectedModel.default_effort})`
									: DEFAULT_LABEL}
							</ComboboxItem>
							{effortOptions.map((effort) => (
								<ComboboxItem key={effort} value={effort}>
									{effort}
								</ComboboxItem>
							))}
						</ComboboxList>
					</ComboboxContent>
				</Combobox>
				{!loading && effortOptions.length === 0 ? (
					<p className="text-[0.8rem] text-muted-foreground">
						This model has no selectable thinking levels.
					</p>
				) : null}
			</div>
		</>
	);
}
