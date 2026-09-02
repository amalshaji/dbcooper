import {
	Check,
	Copy,
	Funnel,
	MagnifyingGlass,
	Pause,
	Play,
	Trash,
} from "@phosphor-icons/react";
import { useVirtualizer } from "@tanstack/react-virtual";
import { useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
	DropdownMenu,
	DropdownMenuCheckboxItem,
	DropdownMenuContent,
	DropdownMenuGroup,
	DropdownMenuLabel,
	DropdownMenuSeparator,
	DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import { Spinner } from "@/components/ui/spinner";
import {
	filterLogEntries,
	type LogEntry,
	type LogLevel,
	type ObservabilityMode,
} from "@/lib/logs";
import type { ObservabilityStreamStatus } from "@/hooks/useObservabilityStream";
import { LogLineRow } from "./LogLineRow";
import { useLogItemKey } from "./useLogItemKey";

const LEVELS: LogLevel[] = [
	"trace",
	"debug",
	"info",
	"warn",
	"error",
	"fatal",
	"unknown",
];

interface LogViewerProps {
	mode: ObservabilityMode;
	entries: LogEntry[];
	status: ObservabilityStreamStatus;
	error: string | null;
	onClear: () => void;
	onRetry: () => void;
}

async function copyPlainText(value: string) {
	await navigator.clipboard.writeText(value);
}

export function LogViewer({
	mode,
	entries,
	status,
	error,
	onClear,
	onRetry,
}: LogViewerProps) {
	const [search, setSearch] = useState("");
	const [levels, setLevels] = useState<Set<LogLevel>>(new Set());
	const [follow, setFollow] = useState(true);
	const [announcement, setAnnouncement] = useState("");
	const viewportRef = useRef<HTMLDivElement>(null);
	const visibleEntries = useMemo(
		() => filterLogEntries(entries, search, levels),
		[entries, levels, search],
	);
	const getItemKey = useLogItemKey(visibleEntries);
	// TanStack Virtual intentionally returns imperative functions used by its measured viewport.
	// eslint-disable-next-line react-hooks/incompatible-library
	const rowVirtualizer = useVirtualizer({
		count: visibleEntries.length,
		getScrollElement: () => viewportRef.current,
		estimateSize: () => 28,
		overscan: 12,
		getItemKey,
	});

	useEffect(() => {
		if (!follow || visibleEntries.length === 0) return;
		const frame = requestAnimationFrame(() => {
			rowVirtualizer.scrollToIndex(visibleEntries.length - 1, { align: "end" });
		});
		return () => cancelAnimationFrame(frame);
	}, [follow, rowVirtualizer, visibleEntries.length]);

	const copyEntry = async (entry: LogEntry) => {
		try {
			await copyPlainText(entry.raw);
			setAnnouncement("Copied log line");
			toast.success("Copied log line");
		} catch {
			setAnnouncement("Could not copy the log line");
			toast.error("Could not copy the log line");
		}
	};
	const copyVisible = async () => {
		try {
			await copyPlainText(visibleEntries.map((entry) => entry.raw).join("\n"));
			const message = `Copied ${visibleEntries.length} visible ${visibleEntries.length === 1 ? "line" : "lines"}`;
			setAnnouncement(message);
			toast.success(message);
		} catch {
			setAnnouncement("Could not copy visible lines");
			toast.error("Could not copy visible lines");
		}
	};
	const toggleLevel = (level: LogLevel, checked: boolean) => {
		setLevels((current) => {
			const next = new Set(current);
			if (checked) next.add(level);
			else next.delete(level);
			return next;
		});
	};
	const clear = () => {
		onClear();
		setAnnouncement("Cleared the local buffer");
	};

	return (
		<section className="flex min-h-0 flex-1 flex-col" aria-label={`${mode} viewer`}>
		<div className="toolbar-material sticky top-0 z-10 flex min-h-10 flex-wrap items-center gap-1.5 border-b px-2 py-1.5">
			<div className="relative min-w-44 flex-1 sm:max-w-72">
				<MagnifyingGlass className="pointer-events-none absolute left-2.5 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground" />
				<Input
					type="search"
					value={search}
					onChange={(event) => setSearch(event.target.value)}
					placeholder={`Search ${mode}`}
					aria-label={`Search ${mode}`}
					className="h-7 pl-8 font-mono text-xs"
				/>
			</div>
			<DropdownMenu>
				<DropdownMenuTrigger
					render={
						<Button
							variant="outline"
							size="sm"
							className="h-7 text-xs"
							aria-label={`Filter levels, ${levels.size} selected`}
						/>
					}
				>
					<Funnel className="size-3.5" />
					Levels{levels.size > 0 ? ` · ${levels.size}` : ""}
				</DropdownMenuTrigger>
				<DropdownMenuContent align="start" className="w-40">
					<DropdownMenuGroup>
						<DropdownMenuLabel>Show levels</DropdownMenuLabel>
						<DropdownMenuSeparator />
						{LEVELS.map((level) => (
							<DropdownMenuCheckboxItem
								key={level}
								checked={levels.has(level)}
								onCheckedChange={(checked) =>
									toggleLevel(level, checked === true)
								}
							>
								{level[0].toUpperCase() + level.slice(1)}
							</DropdownMenuCheckboxItem>
						))}
					</DropdownMenuGroup>
				</DropdownMenuContent>
			</DropdownMenu>
			<Button
				variant={follow ? "default" : "outline"}
				size="sm"
				className="h-7 text-xs"
				aria-pressed={follow}
				onClick={() => setFollow((current) => !current)}
			>
				{follow ? <Pause className="size-3.5" /> : <Play className="size-3.5" />}
				{follow ? "Pause follow" : "Resume follow"}
			</Button>
			<div className="ml-auto flex items-center gap-1">
				<Button
					variant="ghost"
					size="sm"
					className="h-7 text-xs"
					disabled={visibleEntries.length === 0}
					onClick={() => void copyVisible()}
					aria-label="Copy visible lines"
				>
					<Copy className="size-3.5" />
					Copy visible
				</Button>
				<Button
					variant="ghost"
					size="sm"
					className="h-7 text-xs"
					disabled={entries.length === 0}
					onClick={clear}
					aria-label="Clear local log buffer"
				>
					<Trash className="size-3.5" />
					Clear
				</Button>
			</div>
		</div>

		<div className="flex min-h-7 items-center border-b bg-muted/20 px-3 text-[0.6875rem] text-muted-foreground">
			<span className="tabular-figures">
				{visibleEntries.length.toLocaleString()} visible · {entries.length.toLocaleString()} buffered
			</span>
			<span className="ml-auto flex items-center" role="status" aria-live="polite">
				{status === "starting" && <Spinner className="mr-1.5 size-3" />}
				{status === "starting" ? "Starting" : status}
			</span>
		</div>

		{error ? (
			<div role="alert" className="flex items-center gap-2 border-b border-destructive/25 bg-destructive/5 px-3 py-2 text-xs text-destructive">
				<span className="min-w-0 flex-1">{error}</span>
				<Button variant="outline" size="sm" className="h-7" onClick={onRetry}>
					Try again
				</Button>
			</div>
		) : null}

		<div
			ref={viewportRef}
			role="list"
			aria-label={`Live database ${mode}`}
			className="min-h-0 flex-1 overflow-auto bg-background"
		>
			{visibleEntries.length > 0 ? (
				<div
					className="relative w-full"
					style={{ height: `${rowVirtualizer.getTotalSize()}px` }}
				>
					{rowVirtualizer.getVirtualItems().map((virtualRow) => {
						const entry = visibleEntries[virtualRow.index];
						return (
							<div
								key={virtualRow.key}
								data-index={virtualRow.index}
								ref={rowVirtualizer.measureElement}
								className="absolute left-0 top-0 w-full"
								style={{ transform: `translateY(${virtualRow.start}px)` }}
							>
								<LogLineRow
									entry={entry}
									onCopy={(line) => void copyEntry(line)}
								/>
							</div>
						);
					})}
				</div>
			) : (
				<div className="flex h-full min-h-48 flex-col items-center justify-center px-6 text-center">
					{status === "starting" ? (
						<Spinner className="mb-2 size-4" />
					) : (
						<Check className="mb-2 size-4 text-muted-foreground" />
					)}
					<p className="text-sm font-medium">
						{search || levels.size > 0
							? `No ${mode} match the current filters`
							: status === "starting"
								? `Loading recent ${mode}`
								: `No ${mode} received`}
					</p>
					<p className="mt-1 max-w-md text-xs text-muted-foreground">
						{search || levels.size > 0
							? "Change the search or level selection to see more lines."
							: "New database events will appear here while this tab remains open."}
					</p>
				</div>
			)}
		</div>
		<p className="sr-only" aria-live="polite" aria-atomic="true">
			{announcement}
		</p>
	</section>
	);
}
