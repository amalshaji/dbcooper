import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { ArrowLeft, Eye, EyeSlash } from "@phosphor-icons/react";
import { api } from "@/lib/tauri";
import { Spinner } from "@/components/ui/spinner";
import { toast } from "sonner";
import { handleDragStart } from "@/lib/windowDrag";

import {
  Combobox,
  ComboboxInput,
  ComboboxContent,
  ComboboxList,
  ComboboxItem,
} from "@/components/ui/combobox";

type Theme = "light" | "dark" | "system";

export function Settings() {
  const navigate = useNavigate();
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
      await api.settings.set("check_updates_on_startup", checkUpdates.toString());
      await api.settings.set("openai_endpoint", openaiEndpoint);
      await api.settings.set("openai_api_key", openaiApiKey);
      await api.settings.set("openai_model", openaiModel);

      applyTheme(theme);
      toast.success("Settings saved");
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
      const systemTheme = window.matchMedia("(prefers-color-scheme: dark)").matches
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
      <div className="min-h-screen bg-background flex items-center justify-center">
        <Spinner className="w-8 h-8" />
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-background flex flex-col">
      {/* Titlebar region */}
      <header
        onMouseDown={handleDragStart}
        className="h-10 shrink-0 flex items-center gap-2 px-4 pl-20 border-b bg-background"
      >
        <Button variant="ghost" onClick={() => navigate("/")}>
          <ArrowLeft className="mr-2 h-4 w-4" />
          Back
        </Button>
      </header>

      <div className="flex-1 p-8 overflow-auto">
        <div className="max-w-2xl mx-auto">

          <Card>
            <CardHeader>
              <CardTitle>Settings</CardTitle>
              <CardDescription>Configure your preferences</CardDescription>
            </CardHeader>
            <CardContent className="space-y-8">
              <div className="space-y-4">
                <h3 className="text-lg font-medium">Appearance</h3>
                <div className="flex gap-2">
                  {(["light", "dark", "system"] as Theme[]).map((t) => (
                    <Button
                      key={t}
                      variant={theme === t ? "default" : "outline"}
                      onClick={() => setTheme(t)}
                      className="capitalize"
                    >
                      {t}
                    </Button>
                  ))}
                </div>
              </div>

              <div className="space-y-4">
                <h3 className="text-lg font-medium">Updates</h3>
                <div className="flex items-center justify-between">
                  <Label htmlFor="check-updates">Check for updates on startup</Label>
                  <Switch
                    id="check-updates"
                    checked={checkUpdates}
                    onCheckedChange={setCheckUpdates}
                  />
                </div>
              </div>

              <div className="space-y-4">
                <h3 className="text-lg font-medium">OpenAI</h3>
                <div className="space-y-2">
                  <Label htmlFor="openai-endpoint">Endpoint (optional)</Label>
                  <Input
                    id="openai-endpoint"
                    placeholder="https://api.openai.com/v1"
                    value={openaiEndpoint}
                    onChange={(e) => setOpenaiEndpoint(e.target.value)}
                  />
                </div>
                <div className="space-y-2">
                  <Label>Model</Label>
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
                        {!["gpt-4o", "gpt-4o-mini", "gpt-4.1", "gpt-4.1-mini"].includes(openaiModel) && (
                          <ComboboxItem value={openaiModel}>{openaiModel}</ComboboxItem>
                        )}
                      </ComboboxList>
                    </ComboboxContent>
                  </Combobox>
                  <p className="text-[0.8rem] text-muted-foreground">
                    You can select a predefined model or type a custom model ID for your endpoint.
                  </p>
                </div>
                <div className="space-y-2">
                  <Label htmlFor="openai-key">API Key</Label>
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
                      {showApiKey ? <EyeSlash className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                    </Button>
                  </div>
                </div>
              </div>

              <div className="pt-4">
                <Button onClick={handleSave} disabled={saving}>
                  {saving && <Spinner className="mr-2" />}
                  Save Settings
                </Button>
              </div>
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}
