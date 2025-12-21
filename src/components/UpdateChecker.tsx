import { useEffect, useState } from "react";
import { check } from "@tauri-apps/plugin-updater";
import { relaunch } from "@tauri-apps/plugin-process";
import { Badge } from "@/components/ui/badge";
import { Spinner } from "@/components/ui/spinner";
import { api } from "@/lib/tauri";

export function UpdateChecker() {
  const [updateAvailable, setUpdateAvailable] = useState(false);
  const [updateVersion, setUpdateVersion] = useState("");
  const [updating, setUpdating] = useState(false);

  useEffect(() => {
    checkSettingsAndUpdate();
  }, []);

  const checkSettingsAndUpdate = async () => {
    try {
      const checkOnStartup = await api.settings.get("check_updates_on_startup");
      if (checkOnStartup !== "false") {
        checkForUpdates();
      }
    } catch (error) {
      checkForUpdates();
    }
  };

  const checkForUpdates = async () => {
    try {
      const update = await check();
      if (update?.available) {
        setUpdateAvailable(true);
        setUpdateVersion(update.version);
      }
    } catch (error) {
      console.error("Failed to check for updates:", error);
    }
  };

  const handleUpdate = async () => {
    if (!updateAvailable || updating) return;

    try {
      setUpdating(true);
      const update = await check();
      
      if (!update?.available) {
        setUpdateAvailable(false);
        return;
      }

      await update.downloadAndInstall();
      await relaunch();
    } catch (error) {
      console.error("Failed to update:", error);
      setUpdating(false);
    }
  };

  if (!updateAvailable) return null;

  return (
    <Badge
      variant="default"
      className="cursor-pointer hover:bg-primary/90 transition-colors"
      onClick={handleUpdate}
    >
      {updating ? (
        <>
          <Spinner className="mr-2 h-3 w-3" />
          Updating...
        </>
      ) : (
        `Update to v${updateVersion}`
      )}
    </Badge>
  );
}
