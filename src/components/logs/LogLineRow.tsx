import { Copy } from "@phosphor-icons/react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import type { LogEntry, LogLevel } from "@/lib/logs";

const LEVEL_STYLES: Record<LogLevel, string> = {
	trace: "border-l-muted-foreground/35",
	debug: "border-l-muted-foreground/55",
	info: "border-l-primary/55",
	warn: "border-l-amber-600 dark:border-l-amber-400",
	error: "border-l-destructive",
	fatal: "border-l-destructive",
	unknown: "border-l-border",
};

const BADGE_STYLES: Record<LogLevel, string> = {
	trace: "text-muted-foreground",
	debug: "text-muted-foreground",
	info: "text-primary",
	warn: "text-amber-700 dark:text-amber-300",
	error: "text-destructive",
	fatal: "bg-destructive/10 text-destructive",
	unknown: "text-muted-foreground",
};

interface LogLineRowProps {
	entry: LogEntry;
	onCopy: (entry: LogEntry) => void;
}

export function LogLineRow({
	entry,
	onCopy,
}: LogLineRowProps) {
	const showsRaw = entry.timestamp === null || entry.level === "unknown";

	return (
		<div
			role="listitem"
			data-level={entry.level}
			className={cn(
				"group grid min-h-7 cursor-text select-text grid-cols-[7.5rem_3.75rem_minmax(0,1fr)_2rem] items-start border-b border-l-2 border-b-border/55 px-2 py-1 font-mono text-[0.6875rem] leading-[1.125rem] transition-colors hover:bg-muted/45",
				LEVEL_STYLES[entry.level],
			)}
		>
			<time className="truncate pr-3 tabular-figures text-muted-foreground">
				{entry.timestamp ?? "—"}
			</time>
			<span
				className={cn(
					"w-fit rounded-sm px-1 text-[0.625rem] font-semibold tracking-wide",
					BADGE_STYLES[entry.level],
				)}
			>
				{entry.level.toUpperCase()}
			</span>
			<span className="min-w-0 whitespace-pre-wrap break-words text-foreground">
				{showsRaw ? entry.raw : entry.message}
				{!showsRaw && entry.context ? (
					<span className="text-muted-foreground"> {entry.context}</span>
				) : null}
			</span>
			<Button
				type="button"
				variant="ghost"
				size="icon-sm"
				aria-label="Copy log line"
				title="Copy log line"
				className="size-6 opacity-0 group-hover:opacity-100 group-focus-within:opacity-100"
				onClick={() => onCopy(entry)}
			>
				<Copy className="size-3.5" />
			</Button>
		</div>
	);
}
