import {
	CheckCircle,
	Eye,
	EyeSlash,
	WarningCircle,
} from "@phosphor-icons/react";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
	Combobox,
	ComboboxContent,
	ComboboxInput,
	ComboboxItem,
	ComboboxList,
} from "@/components/ui/combobox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Spinner } from "@/components/ui/spinner";
import { Switch } from "@/components/ui/switch";
import { useTheme } from "@/contexts/ThemeContext";
import { loadSettingsFormData } from "@/lib/settingsFormData";
import { type AiHarnessStatus, type AiProvider, api } from "@/lib/tauri";
import { resolveUpdateChannel } from "@/lib/updateChannel";
import { ThemeSelector } from "./ThemeSelector";
import { UpdateChannelSetting } from "./UpdateChannelSetting";

interface SettingsFormProps {
	onSaveSuccess?: () => void;
	compact?: boolean;
}

const aiProviderOptions: Array<{ value: AiProvider; label: string }> = [
	{ value: "openai", label: "OpenAI-compatible API" },
	{ value: "claude_code", label: "Claude Code" },
	{ value: "codex_cli", label: "Codex CLI" },
	{ value: "opencode_cli", label: "opencode" },
];

export function SettingsForm({ onSaveSuccess, compact }: SettingsFormProps) {
	const [loading, setLoading] = useState(true);
	const [saving, setSaving] = useState(false);
	const [showApiKey, setShowApiKey] = useState(false);

	const { theme, setTheme } = useTheme();
	const [checkUpdates, setCheckUpdates] = useState(true);
	const [canaryUpdates, setCanaryUpdates] = useState(false);
	const [aiProvider, setAiProvider] = useState<AiProvider>("openai");
	const [detectedHarnesses, setDetectedHarnesses] = useState<AiHarnessStatus[]>(
		[],
	);
	const [openaiEndpoint, setOpenaiEndpoint] = useState("");
	const [openaiApiKey, setOpenaiApiKey] = useState("");
	const [openaiModel, setOpenaiModel] = useState("gpt-4.1");

	useEffect(() => {
		loadSettings();
	}, []);

	const loadSettings = async () => {
		setLoading(true);
		try {
			const { settings, harnesses } = await loadSettingsFormData(
				api.settings.getAll,
				api.ai.detectHarnesses,
			);
			setCheckUpdates(settings.check_updates_on_startup !== "false");
			setCanaryUpdates(
				resolveUpdateChannel(settings.update_channel) === "canary",
			);
			setAiProvider((settings.ai_provider as AiProvider) || "openai");
			setOpenaiEndpoint(settings.openai_endpoint || "");
			setOpenaiApiKey(settings.openai_api_key || "");
			setOpenaiModel(settings.openai_model || "gpt-4.1");
			setDetectedHarnesses(harnesses);
		} catch (error) {
			console.error("Failed to load settings:", error);
		} finally {
			setLoading(false);
		}
	};

	const handleSave = async () => {
		setSaving(true);
		try {
			await api.settings.setMany({
				check_updates_on_startup: checkUpdates.toString(),
				update_channel: canaryUpdates ? "canary" : "stable",
				ai_provider: aiProvider,
				openai_endpoint: openaiEndpoint,
				openai_api_key: openaiApiKey,
				openai_model: openaiModel,
			});

			window.dispatchEvent(new Event("ai-settings-changed"));
			toast.success("Settings saved");
			onSaveSuccess?.();
		} catch (error) {
			console.error("Failed to save settings:", error);
			toast.error("Failed to save settings");
		} finally {
			setSaving(false);
		}
	};

	if (loading) {
		return (
			<div className="flex items-center justify-center py-10">
				<Spinner className="size-5" />
				<span className="ml-3 text-sm text-muted-foreground">
					Loading preferences…
				</span>
			</div>
		);
	}

	const spacing = compact ? "space-y-4" : "space-y-8";
	const headingSize = compact ? "text-sm font-medium" : "text-lg font-medium";
	const sectionClass = compact
		? "space-y-3"
		: "space-y-4 border-b pb-6 last:border-b-0 last:pb-0";
	const selectedHarness = detectedHarnesses.find(
		(harness) => harness.provider === aiProvider,
	);

	return (
		<div className={spacing}>
			<div className={sectionClass}>
				<div>
					<h3 className={headingSize}>Appearance</h3>
					{!compact && (
						<p className="mt-1 text-xs text-muted-foreground">
							Match the window to your workspace or follow macOS.
						</p>
					)}
				</div>
				<ThemeSelector
					theme={theme}
					compact={compact}
					onThemeChange={setTheme}
				/>
			</div>

			<div className={sectionClass}>
				<div>
					<h3 className={headingSize}>Updates</h3>
					{!compact && (
						<p className="mt-1 text-xs text-muted-foreground">
							Keep DBcooper current without interrupting your work.
						</p>
					)}
				</div>
				<div className="flex items-center justify-between rounded-md border bg-card px-3 py-2.5">
					<div>
						<Label htmlFor="check-updates" className={compact ? "text-sm" : ""}>
							Check for updates on startup
						</Label>
						{!compact && (
							<p className="mt-0.5 text-xs text-muted-foreground">
								You can still install updates when you are ready.
							</p>
						)}
					</div>
					<Switch
						id="check-updates"
						checked={checkUpdates}
						onCheckedChange={setCheckUpdates}
					/>
				</div>
				<UpdateChannelSetting
					enabled={canaryUpdates}
					onEnabledChange={setCanaryUpdates}
					compact={compact}
				/>
			</div>

			<div className={sectionClass}>
				<div>
					<h3 className={headingSize}>AI SQL</h3>
					{!compact && (
						<p className="mt-1 text-xs text-muted-foreground">
							Generate schema-aware drafts. Queries are previewed and never run
							automatically.
						</p>
					)}
				</div>
				<div className="space-y-2">
					<Label className={compact ? "text-sm" : ""}>Provider</Label>
					<Combobox
						value={aiProvider}
						onValueChange={(val) => val && setAiProvider(val as AiProvider)}
					>
						<ComboboxInput
							placeholder="Select AI provider..."
							value={
								aiProviderOptions.find((option) => option.value === aiProvider)
									?.label ?? aiProvider
							}
							readOnly
						/>
						<ComboboxContent>
							<ComboboxList>
								{aiProviderOptions.map((option) => (
									<ComboboxItem key={option.value} value={option.value}>
										{option.label}
									</ComboboxItem>
								))}
							</ComboboxList>
						</ComboboxContent>
					</Combobox>
				</div>

				{aiProvider === "openai" ? (
					<>
						<div className="space-y-2">
							<Label
								htmlFor="openai-endpoint"
								className={compact ? "text-sm" : ""}
							>
								Endpoint (optional)
							</Label>
							<Input
								id="openai-endpoint"
								placeholder="https://api.openai.com/v1"
								value={openaiEndpoint}
								onChange={(e) => setOpenaiEndpoint(e.target.value)}
							/>
						</div>
						<div className="space-y-2">
							<Label className={compact ? "text-sm" : ""}>Model</Label>
							<Combobox
								value={openaiModel}
								onValueChange={(val) => val && setOpenaiModel(val as string)}
							>
								<ComboboxInput
									placeholder="Select or type model..."
									value={openaiModel}
									onChange={(e) => setOpenaiModel(e.target.value)}
								/>
								<ComboboxContent>
									<ComboboxList>
										<ComboboxItem value="gpt-4o">gpt-4o</ComboboxItem>
										<ComboboxItem value="gpt-4o-mini">gpt-4o-mini</ComboboxItem>
										<ComboboxItem value="gpt-4.1">gpt-4.1</ComboboxItem>
										<ComboboxItem value="gpt-4.1-mini">
											gpt-4.1-mini
										</ComboboxItem>
										{![
											"gpt-4o",
											"gpt-4o-mini",
											"gpt-4.1",
											"gpt-4.1-mini",
										].includes(openaiModel) && (
											<ComboboxItem value={openaiModel}>
												{openaiModel}
											</ComboboxItem>
										)}
									</ComboboxList>
								</ComboboxContent>
							</Combobox>
							<p className="text-[0.8rem] text-muted-foreground">
								You can select a predefined model or type a custom model ID
								{compact ? "." : " for your endpoint."}
							</p>
						</div>
						<div className="space-y-2">
							<Label htmlFor="openai-key" className={compact ? "text-sm" : ""}>
								API key
							</Label>
							<div className="relative">
								<Input
									id="openai-key"
									type={showApiKey ? "text" : "password"}
									placeholder="sk-..."
									value={openaiApiKey}
									onChange={(e) => setOpenaiApiKey(e.target.value)}
									className="pr-10"
								/>
								<Button
									type="button"
									variant="ghost"
									size="icon"
									className="absolute right-0 top-0 h-full"
									onClick={() => setShowApiKey(!showApiKey)}
									aria-label={showApiKey ? "Hide API key" : "Show API key"}
								>
									{showApiKey ? (
										<EyeSlash className="h-4 w-4" />
									) : (
										<Eye className="h-4 w-4" />
									)}
								</Button>
							</div>
						</div>
					</>
				) : (
					<div className="rounded-md border bg-muted/30 p-3 text-sm text-muted-foreground">
						<p>
							DBcooper will call your local{" "}
							{aiProviderOptions.find((option) => option.value === aiProvider)
								?.label ?? "AI harness"}{" "}
							using its existing login. Your prompt and selected schema are
							passed to that tool; it may still use its configured cloud
							provider.
						</p>
						<div className="mt-3 flex items-start border-t pt-3">
							{selectedHarness?.available ? (
								<CheckCircle
									className="mr-2 mt-0.5 size-4 shrink-0 text-emerald-500"
									weight="fill"
								/>
							) : (
								<WarningCircle className="mr-2 mt-0.5 size-4 shrink-0 text-amber-500" />
							)}
							<div className="min-w-0">
								<p className="font-medium text-foreground">
									{selectedHarness?.available
										? "Local harness found"
										: "Local harness not detected"}
								</p>
								<p className="mt-0.5 break-all font-mono text-[11px]">
									{selectedHarness?.available
										? selectedHarness.path
										: (selectedHarness?.error ??
											"Install or sign in to the selected tool.")}
								</p>
							</div>
						</div>
					</div>
				)}
			</div>

			<div className={compact ? "pt-2" : "pt-4"}>
				<Button
					onClick={handleSave}
					disabled={saving}
					className={compact ? "w-full" : ""}
				>
					{saving && <Spinner />}
					Save settings
				</Button>
			</div>
		</div>
	);
}
