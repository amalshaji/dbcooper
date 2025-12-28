import { useEffect, useState } from "react";
import { check, Update } from "@tauri-apps/plugin-updater";
import { relaunch } from "@tauri-apps/plugin-process";
import { Badge } from "@/components/ui/badge";
import { Spinner } from "@/components/ui/spinner";
import { api } from "@/lib/tauri";
import { toast } from "sonner";

export function UpdateChecker() {
  const [updateAvailable, setUpdateAvailable] = useState(false);
  const [updateVersion, setUpdateVersion] = useState("");
  const [downloading, setDownloading] = useState(false);
  const [readyToInstall, setReadyToInstall] = useState(false);
  const [updateRef, setUpdateRef] = useState<Update | null>(null);

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
        setUpdateRef(update);
      }
    } catch (error) {
      console.error("Failed to check for updates:", error);
    }
  };

  const handleDownload = async () => {
    if (!updateRef || downloading || readyToInstall) return;

    try {
      setDownloading(true);
      let downloaded = 0;
      let contentLength = 0;
      
      await updateRef.download((event) => {
        switch (event.event) {
          case 'Started':
            contentLength = event.data.contentLength ?? 0;
            console.log(`Download started, total size: ${contentLength}`);
            break;
          case 'Progress':
            downloaded += event.data.chunkLength;
            console.log(`Downloaded ${downloaded} of ${contentLength}`);
            break;
          case 'Finished':
            console.log('Download finished');
            break;
        }
      });
      
      setReadyToInstall(true);
    } catch (error) {
      console.error("Failed to download update:", error);
      toast.error(`Failed to download update: ${error}`);
    } finally {
      setDownloading(false);
    }
  };

  const handleInstall = async () => {
    if (!updateRef || !readyToInstall) return;

    try {
      await updateRef.install();
      await relaunch();
    } catch (error) {
      console.error("Failed to install update:", error);
      toast.error(`Failed to install update: ${error}`);
    }
  };

  if (!updateAvailable) return null;

  if (readyToInstall) {
    return (
      <Badge
        variant="default"
        className="cursor-pointer hover:bg-primary/90 transition-colors"
        onClick={handleInstall}
      >
        Restart to update
      </Badge>
    );
  }

  return (
    <Badge
      variant="default"
      className="cursor-pointer hover:bg-primary/90 transition-colors"
      onClick={handleDownload}
    >
      {downloading ? (
        <>
          <Spinner className="h-3 w-3" />
          Downloading...
        </>
      ) : (
        `Update to v${updateVersion}`
      )}
    </Badge>
  );
}
