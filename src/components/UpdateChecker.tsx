import { useEffect, useState, useRef } from "react";
import { check, type Update } from "@tauri-apps/plugin-updater";
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
	const [checkingManually, setCheckingManually] = useState(false);
	const [readyToInstall, setReadyToInstall] = useState(false);
	const [downloadStarted, setDownloadStarted] = useState(false);
	const [downloadedBytes, setDownloadedBytes] = useState(0);
	const [totalBytes, setTotalBytes] = useState<number | null>(null);
	const updateRef = useRef<Update | null>(null);
	const downloadedBytesRef = useRef(0);
	const totalBytesRef = useRef<number | null>(null);

	const formatBytes = (bytes: number): string => {
		if (bytes < 1024) return `${bytes} B`;

		const units = ["KB", "MB", "GB"];
		let value = bytes / 1024;
		let unitIndex = 0;

		while (value >= 1024 && unitIndex < units.length - 1) {
			value /= 1024;
			unitIndex += 1;
		}

		const precision = value >= 100 ? 0 : value >= 10 ? 1 : 2;
		return `${value.toFixed(precision)} ${units[unitIndex]}`;
	};

	const downloadProgress =
		totalBytes && totalBytes > 0
			? Math.min(100, Math.round((downloadedBytes / totalBytes) * 100))
			: null;

	useEffect(() => {
		checkSettingsAndUpdate();
	}, []);

	const checkSettingsAndUpdate = async () => {
		try {
			const checkOnStartup = await api.settings.get("check_updates_on_startup");
			if (checkOnStartup !== "false") {
				await checkForUpdates(false);
			}
		} catch {
			await checkForUpdates(false);
		}
	};

	const checkForUpdates = async (manual: boolean = false) => {
		if (manual && checkingManually) return;

		try {
			if (manual) {
				setCheckingManually(true);
			}
			const update = await check();
			if (update?.available) {
				setUpdateAvailable(true);
				setUpdateVersion(update.version);
				updateRef.current = update;
			} else if (manual) {
				toast.info("You're on the latest version");
			}
		} catch (error) {
			console.error("Failed to check for updates:", error);
			if (manual) {
				toast.error("Failed to check for updates");
			}
		} finally {
			if (manual) {
				setCheckingManually(false);
			}
		}
	};

	const handleDownload = async () => {
		const update = updateRef.current;
		if (!update || downloading || readyToInstall) return;

		try {
			setDownloading(true);
			setDownloadStarted(false);
			setDownloadedBytes(0);
			setTotalBytes(null);
			downloadedBytesRef.current = 0;
			totalBytesRef.current = null;

			await update.download((event) => {
				if (event.event === "Started") {
					setDownloadStarted(true);
					const contentLength = event.data.contentLength ?? null;
					setTotalBytes(contentLength);
					totalBytesRef.current = contentLength;
					return;
				}

				if (event.event === "Progress") {
					setDownloadStarted(true);
					setDownloadedBytes((previous) => {
						const next = previous + event.data.chunkLength;
						downloadedBytesRef.current = next;
						return next;
					});
					return;
				}

				if (event.event === "Finished" && totalBytesRef.current == null) {
					setTotalBytes(downloadedBytesRef.current);
					totalBytesRef.current = downloadedBytesRef.current;
				}
			});
			setReadyToInstall(true);
		} catch (error) {
			console.error("Failed to download update:", error);
			toast.error(`Failed to download update: ${error}`);
		} finally {
			setDownloading(false);
			setDownloadStarted(false);
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

	// Ready to install state
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

	// Update available state
	if (updateAvailable) {
		return (
			<Badge
				variant="secondary"
				className={`cursor-pointer transition-colors rounded-md ${downloading ? "cursor-default relative overflow-hidden pr-1.5" : "hover:bg-secondary/80"}`}
				onClick={!downloading ? handleDownload : undefined}
			>
				{downloading ? (
					<>
						<Spinner className="h-3 w-3" />
						{downloadStarted ? (
							<>
								<span className="tabular-nums text-[10px]">
									{totalBytes !== null
										? `${formatBytes(downloadedBytes)} / ${formatBytes(totalBytes)}`
										: `${formatBytes(downloadedBytes)}`}
									{downloadProgress !== null ? ` ${downloadProgress}%` : ""}
								</span>
								<div className="pointer-events-none absolute left-1 right-1 bottom-[2px] h-[2px] rounded-full bg-secondary-foreground/20 overflow-hidden">
									<div
										className={`h-full bg-secondary-foreground ${
											downloadProgress === null
												? "w-1/3 animate-pulse"
												: "transition-[width] duration-150"
										}`}
										style={
											downloadProgress !== null
												? { width: `${downloadProgress}%` }
												: undefined
										}
									/>
								</div>
							</>
						) : (
							<span>Starting download...</span>
						)}
						<span className="sr-only">
							{downloadStarted && totalBytes !== null
								? `Downloading v${updateVersion}: ${formatBytes(downloadedBytes)} of ${formatBytes(totalBytes)}, ${downloadProgress ?? 0}%`
								: `Downloading v${updateVersion}`}
						</span>
					</>
				) : (
					`Update to v${updateVersion}`
				)}
			</Badge>
		);
	}

	// Default state - always visible check button (same style as other states)
	return (
		<Badge
			variant="secondary"
			className={`cursor-pointer transition-colors rounded-md ${checkingManually ? "" : "hover:bg-secondary/80"}`}
			onClick={!checkingManually ? () => checkForUpdates(true) : undefined}
		>
			{checkingManually ? (
				<>
					<Spinner className="h-3 w-3" />
					Checking for updates
				</>
			) : (
				"Check for updates"
			)}
		</Badge>
	);
}
