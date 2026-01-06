import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Eye, EyeSlash } from "@phosphor-icons/react";
import { api } from "@/lib/tauri";
import { Spinner } from "@/components/ui/spinner";
import { toast } from "sonner";
import {
	Combobox,
	ComboboxInput,
	ComboboxContent,
	ComboboxList,
	ComboboxItem,
} from "@/components/ui/combobox";

type Theme = "light" | "dark" | "system";

interface SettingsFormProps {
	onSaveSuccess?: () => void;
	compact?: boolean;
}

export function SettingsForm({ onSaveSuccess, compact }: SettingsFormProps) {
	const [loading, setLoading] = useState(true);
	const [saving, setSaving] = useState(false);
	const [showApiKey, setShowApiKey] = useState(false);

	const [theme, setTheme] = useState<Theme>("system");
	const [checkUpdates, setCheckUpdates] = useState(true);
	const [openaiEndpoint, setOpenaiEndpoint] = useState("");
	const [openaiApiKey, setOpenaiApiKey] = useState("");
	const [openaiModel, setOpenaiModel] = useState("gpt-4.1");

	useEffect(() => {
		loadSettings();
	}, []);

	const loadSettings = async () => {
		setLoading(true);
		try {
			const settings = await api.settings.getAll();
			setTheme((settings.theme as Theme) || "system");
			setCheckUpdates(settings.check_updates_on_startup !== "false");
			setOpenaiEndpoint(settings.openai_endpoint || "");
			setOpenaiApiKey(settings.openai_api_key || "");
			setOpenaiModel(settings.openai_model || "gpt-4.1");
		} catch (error) {
			console.error("Failed to load settings:", error);
		} finally {
			setLoading(false);
		}
	};

	const handleSave = async () => {
		setSaving(true);
		try {
			await api.settings.set("theme", theme);
			await api.settings.set(
				"check_updates_on_startup",
				checkUpdates.toString(),
			);
			await api.settings.set("openai_endpoint", openaiEndpoint);
			await api.settings.set("openai_api_key", openaiApiKey);
			await api.settings.set("openai_model", openaiModel);

			applyTheme(theme);
			toast.success("Settings saved");
			onSaveSuccess?.();
		} catch (error) {
			console.error("Failed to save settings:", error);
			toast.error("Failed to save settings");
		} finally {
			setSaving(false);
		}
	};

	const applyTheme = (t: Theme) => {
		const root = window.document.documentElement;
		if (t === "system") {
			const systemTheme = window.matchMedia("(prefers-color-scheme: dark)")
				.matches
				? "dark"
				: "light";
			root.classList.toggle("dark", systemTheme === "dark");
		} else {
			root.classList.toggle("dark", t === "dark");
		}
		localStorage.setItem("theme", t);
	};

	if (loading) {
		return (
			<div className="flex items-center justify-center py-8">
				<Spinner className="w-8 h-8" />
			</div>
		);
	}

	const spacing = compact ? "space-y-4" : "space-y-8";
	const headingSize = compact ? "text-sm font-medium" : "text-lg font-medium";

	return (
		<div className={spacing}>
			<div className="space-y-3">
				<h3 className={headingSize}>Appearance</h3>
				<div className="flex gap-2">
					{(["light", "dark", "system"] as Theme[]).map((t) => (
						<Button
							key={t}
							variant={theme === t ? "default" : "outline"}
							onClick={() => setTheme(t)}
							className="capitalize"
							size={compact ? "sm" : "default"}
						>
							{t}
						</Button>
					))}
				</div>
			</div>

			<div className="space-y-3">
				<h3 className={headingSize}>Updates</h3>
				<div className="flex items-center justify-between">
					<Label htmlFor="check-updates" className={compact ? "text-sm" : ""}>
						Check for updates on startup
					</Label>
					<Switch
						id="check-updates"
						checked={checkUpdates}
						onCheckedChange={setCheckUpdates}
					/>
				</div>
			</div>

			<div className="space-y-3">
				<h3 className={headingSize}>OpenAI</h3>
				<div className="space-y-2">
					<Label htmlFor="openai-endpoint" className={compact ? "text-sm" : ""}>
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
								<ComboboxItem value="gpt-4.1-mini">gpt-4.1-mini</ComboboxItem>
								{![
									"gpt-4o",
									"gpt-4o-mini",
									"gpt-4.1",
									"gpt-4.1-mini",
								].includes(openaiModel) && (
									<ComboboxItem value={openaiModel}>{openaiModel}</ComboboxItem>
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
						API Key
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
						>
							{showApiKey ? (
								<EyeSlash className="h-4 w-4" />
							) : (
								<Eye className="h-4 w-4" />
							)}
						</Button>
					</div>
				</div>
			</div>

			<div className={compact ? "pt-2" : "pt-4"}>
				<Button
					onClick={handleSave}
					disabled={saving}
					className={compact ? "w-full" : ""}
				>
					{saving && <Spinner />}
					Save Settings
				</Button>
			</div>
		</div>
	);
}
