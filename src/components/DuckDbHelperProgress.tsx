import {
	formatDuckDbHelperBytes,
	getDuckDbHelperProgressView,
	type DuckDbHelperProgress as DuckDbHelperProgressValue,
} from "@/lib/duckdbHelper";

interface DuckDbHelperProgressProps {
	progress: DuckDbHelperProgressValue;
}

export function DuckDbHelperProgress({
	progress,
}: DuckDbHelperProgressProps) {
	const { label, percent } = getDuckDbHelperProgressView(progress);
	const downloaded = formatDuckDbHelperBytes(progress.downloadedBytes);
	const byteProgress = progress.totalBytes
		? `${downloaded} of ${formatDuckDbHelperBytes(progress.totalBytes)}`
		: progress.downloadedBytes > 0
			? `${downloaded} downloaded`
			: null;
	const detail = byteProgress
		? `${byteProgress}${percent !== null ? ` · ${percent}%` : ""}`
		: progress.stage === "downloading"
			? "Preparing download"
			: percent !== null
				? `${percent}%`
				: "Finalizing setup";
	return (
		<div className="rounded-lg border bg-muted/30 p-3" aria-live="polite">
			<div
				data-testid="duckdb-progress-metadata"
				className="mb-2 grid min-h-8 grid-rows-2 text-xs leading-4"
			>
				<span className="truncate whitespace-nowrap font-medium text-foreground">
					{label}
				</span>
				<span
					data-testid="duckdb-progress-detail"
					className="truncate whitespace-nowrap tabular-nums text-muted-foreground"
				>
					{detail}
				</span>
			</div>
			<div
				className="h-1.5 overflow-hidden rounded-full bg-muted"
				role="progressbar"
				aria-label={label}
				aria-valuemin={0}
				aria-valuemax={100}
				aria-valuenow={percent ?? undefined}
			>
				{percent === null ? (
					<div
						data-testid="duckdb-progress-indeterminate"
						className="h-full w-1/3 rounded-full bg-primary motion-safe:animate-[duckdb-progress-indeterminate_1.2s_ease-in-out_infinite] motion-reduce:animate-pulse"
					/>
				) : (
					<div
						data-testid="duckdb-progress-determinate"
						className="h-full w-full origin-left rounded-full bg-primary transition-transform duration-300 ease-out motion-reduce:transition-none"
						style={{ transform: `scaleX(${percent / 100})` }}
					/>
				)}
			</div>
		</div>
	);
}
