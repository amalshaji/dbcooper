import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import type { ConnectionType } from "@/types/connection";

export type DuckDbHelperStage =
	| "downloading"
	| "verifying"
	| "installing"
	| "ready";

export interface DuckDbHelperProgress {
	stage: DuckDbHelperStage;
	downloadedBytes: number;
	totalBytes: number | null;
}

export interface DuckDbHelperStatus {
	version: string;
	path: string;
	downloaded: boolean;
}

export const initialDuckDbHelperProgress: DuckDbHelperProgress = {
	stage: "downloading",
	downloadedBytes: 0,
	totalBytes: null,
};

export function formatDuckDbHelperBytes(bytes: number): string {
	if (bytes < 1024 * 1024) {
		return `${(bytes / 1024).toFixed(bytes < 10 * 1024 ? 1 : 0)} KB`;
	}
	return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export function getDuckDbHelperProgressView(progress: DuckDbHelperProgress): {
	label: string;
	percent: number | null;
} {
	const labels: Record<DuckDbHelperStage, string> = {
		downloading: "Downloading DuckDB support",
		verifying: "Verifying download",
		installing: "Installing DuckDB support",
		ready: "DuckDB support is ready",
	};
	const percent =
		progress.stage === "ready"
			? 100
			: progress.totalBytes && progress.totalBytes > 0
				? Math.min(
						100,
						Math.round((progress.downloadedBytes / progress.totalBytes) * 100),
					)
				: null;
	return { label: labels[progress.stage], percent };
}

export async function ensureDuckDbHelper(
	onProgress: (progress: DuckDbHelperProgress) => void,
): Promise<DuckDbHelperStatus> {
	const unlisten = await listen<DuckDbHelperProgress>(
		"duckdb-helper-progress",
		(event) => onProgress(event.payload),
	);
	try {
		return await invoke<DuckDbHelperStatus>("ensure_duckdb_helper");
	} finally {
		unlisten();
	}
}

export async function prepareDuckDbRuntime(
	dbType: ConnectionType,
	onProgress: (progress: DuckDbHelperProgress) => void,
): Promise<void> {
	if (dbType !== "duckdb") return;
	onProgress(initialDuckDbHelperProgress);
	await ensureDuckDbHelper(onProgress);
}
