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
	return (
		<div className="rounded-lg border bg-muted/30 p-3" aria-live="polite">
			<div className="mb-2 flex items-center justify-between text-xs">
				<span className="font-medium text-foreground">{label}</span>
				<span className="tabular-nums text-muted-foreground">
					{byteProgress}
					{byteProgress && percent !== null ? " · " : ""}
					{percent !== null ? `${percent}%` : ""}
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
				<div
					className={`h-full rounded-full bg-primary transition-[width] duration-200 ${
						percent === null ? "w-1/3 animate-pulse" : ""
					}`}
					style={percent === null ? undefined : { width: `${percent}%` }}
				/>
			</div>
		</div>
	);
}
