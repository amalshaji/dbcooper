import { useEffect, useState, useRef } from "react";
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
	const updateRef = useRef<Update | null>(null);

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
				updateRef.current = update;
			}
		} catch (error) {
			console.error("Failed to check for updates:", error);
		}
	};

	const handleDownload = async () => {
		const update = updateRef.current;
		if (!update || downloading || readyToInstall) return;

		try {
			setDownloading(true);
			await update.download(() => {});
			setReadyToInstall(true);
		} catch (error) {
			console.error("Failed to download update:", error);
			toast.error(`Failed to download update: ${error}`);
		} finally {
			setDownloading(false);
		}
	};

	const handleInstall = async () => {
		const update = updateRef.current;
		if (!update || !readyToInstall) return;

		try {
			await update.install();
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
			className={`cursor-pointer transition-colors rounded-md ${downloading ? "" : "hover:bg-secondary/80"}`}
			onClick={!downloading ? handleDownload : undefined}
		>
			{downloading ? (
				<>
					<Spinner className="h-3 w-3" />
					Downloading v{updateVersion}
				</>
			) : (
				`Update to v${updateVersion}`
			)}
		</Badge>
	);
}
