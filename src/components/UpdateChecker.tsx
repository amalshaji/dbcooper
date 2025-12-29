import { useEffect, useState } from "react";
import { check, Update } from "@tauri-apps/plugin-updater";
import { relaunch } from "@tauri-apps/plugin-process";
import { ArrowRight } from "@phosphor-icons/react";
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
	const [autodownloadEnabled, setAutodownloadEnabled] = useState(false);

	useEffect(() => {
		checkSettingsAndUpdate();
	}, []);

	const checkSettingsAndUpdate = async () => {
		try {
			const checkOnStartup = await api.settings.get("check_updates_on_startup");
			const autodownload = await api.settings.get("autodownload_updates");
			setAutodownloadEnabled(autodownload === "true");

			if (checkOnStartup !== "false") {
				checkForUpdates();
			}
		} catch (error) {
			setAutodownloadEnabled(false);
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

				// Check if autodownload is enabled
				if (autodownloadEnabled) {
					handleDownload();
				}
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
					case "Started":
						contentLength = event.data.contentLength ?? 0;
						console.log(`Download started, total size: ${contentLength}`);
						break;
					case "Progress":
						downloaded += event.data.chunkLength;
						console.log(`Downloaded ${downloaded} of ${contentLength}`);
						break;
					case "Finished":
						console.log("Download finished");
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
				className="cursor-pointer hover:bg-primary/90 transition-colors rounded-md"
				onClick={handleInstall}
			>
				Restart to update
				<ArrowRight className="ml-1 h-3 w-3" />
			</Badge>
		);
	}

	return (
		<Badge
			variant="secondary"
			className={`transition-colors rounded-md ${
				!autodownloadEnabled || downloading
					? ""
					: "cursor-pointer hover:bg-primary/90"
			}`}
			onClick={
				!autodownloadEnabled && !downloading ? handleDownload : undefined
			}
		>
			{downloading ? (
				<>
					<Spinner className="h-3 w-3" />
					Downloading update
				</>
			) : (
				`Update to v${updateVersion}`
			)}
		</Badge>
	);
}
