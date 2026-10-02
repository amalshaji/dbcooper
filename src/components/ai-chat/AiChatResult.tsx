import {
	ArrowSquareOut,
	ChartBar,
	Copy,
	DownloadSimple,
	Table as TableIcon,
} from "@phosphor-icons/react";
import { lazy, Suspense, useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Spinner } from "@/components/ui/spinner";
import {
	Table,
	TableBody,
	TableCell,
	TableHead,
	TableHeader,
	TableRow,
} from "@/components/ui/table";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
	type Dataset,
	formatLabel,
	resolveChartSpec,
	toDataset,
} from "@/lib/aiChat/chartData";
import type { AiChatMessage } from "@/lib/tauri/aiChat";

const ResultChart = lazy(() => import("./ResultChart"));

const TABLE_PREVIEW_ROWS = 100;

function ResultTable({ dataset }: { dataset: Dataset }) {
	const rows = dataset.rows.slice(0, TABLE_PREVIEW_ROWS);
	return (
		<div className="max-h-72 overflow-auto rounded-md border bg-card">
			<Table>
				<TableHeader className="sticky top-0 bg-card">
					<TableRow>
						{dataset.columns.map((column) => (
							<TableHead key={column} className="whitespace-nowrap">
								{column}
							</TableHead>
						))}
					</TableRow>
				</TableHeader>
				<TableBody>
					{rows.map((row, index) => (
						<TableRow key={index}>
							{dataset.columns.map((column) => (
								<TableCell
									key={column}
									className="max-w-60 truncate font-mono tabular-nums"
								>
									{formatLabel(row[column])}
								</TableCell>
							))}
						</TableRow>
					))}
				</TableBody>
			</Table>
		</div>
	);
}

async function exportPng(node: HTMLElement) {
	const { toPng } = await import("html-to-image");
	const { save } = await import("@tauri-apps/plugin-dialog");
	const { writeFile } = await import("@tauri-apps/plugin-fs");
	const { revealItemInDir } = await import("@tauri-apps/plugin-opener");

	const filePath = await save({
		defaultPath: `chart-${new Date().toISOString().slice(0, 10)}.png`,
		filters: [{ name: "PNG Image", extensions: ["png"] }],
	});
	if (!filePath) return;

	try {
		const dataUrl = await toPng(node, {
			pixelRatio: 2,
			backgroundColor: getComputedStyle(node).backgroundColor,
		});
		const bytes = new Uint8Array(await (await fetch(dataUrl)).arrayBuffer());
		await writeFile(filePath, bytes);
		toast.success("Chart exported", {
			action: {
				label: "Open File Location",
				onClick: () => revealItemInDir(filePath),
			},
		});
	} catch (error) {
		toast.error("Failed to export chart", {
			description: error instanceof Error ? error.message : String(error),
		});
	}
}

interface AiChatResultProps {
	message: AiChatMessage;
	onOpenQuery?: (query: string) => void;
}

export function AiChatResult({ message, onOpenQuery }: AiChatResultProps) {
	const result = message.result;
	const dataset = useMemo(() => toDataset(result?.rows ?? []), [result]);
	const resolution = useMemo(
		() => resolveChartSpec(message.chart, dataset),
		[message.chart, dataset],
	);
	const [view, setView] = useState<"chart" | "table">(
		resolution.ok ? "chart" : "table",
	);
	const [exporting, setExporting] = useState(false);
	const chartRef = useRef<HTMLDivElement>(null);

	if (!result) return null;
	const step = message.steps.find((candidate) => candidate.id === result.step);
	const showChart = resolution.ok && view === "chart";

	const copyQuery = async () => {
		if (!step) return;
		await navigator.clipboard.writeText(step.query);
		toast.success("Query copied");
	};

	const handleExport = async () => {
		if (!chartRef.current) return;
		setExporting(true);
		try {
			await exportPng(chartRef.current);
		} finally {
			setExporting(false);
		}
	};

	return (
		<div className="space-y-2">
			<div className="flex items-center gap-1">
				{resolution.ok ? (
					<Tabs
						value={view}
						onValueChange={(value) => setView(value as "chart" | "table")}
					>
						<TabsList className="h-7">
							<TabsTrigger value="chart" className="text-[11px]">
								<ChartBar className="size-3.5" />
								Chart
							</TabsTrigger>
							<TabsTrigger value="table" className="text-[11px]">
								<TableIcon className="size-3.5" />
								Table
							</TabsTrigger>
						</TabsList>
					</Tabs>
				) : null}
				<span className="ml-1 text-[11px] text-muted-foreground tabular-nums">
					{dataset.rows.length.toLocaleString()}
					{result.truncated ? "+" : ""} rows
				</span>
				<div className="ml-auto flex items-center">
					{step ? (
						<Button
							variant="ghost"
							size="icon-xs"
							onClick={() => void copyQuery()}
							aria-label="Copy query"
							title="Copy query"
						>
							<Copy />
						</Button>
					) : null}
					{step && onOpenQuery && step.language === "sql" ? (
						<Button
							variant="ghost"
							size="icon-xs"
							onClick={() => onOpenQuery(step.query)}
							aria-label="Open in query tab"
							title="Open in query tab"
						>
							<ArrowSquareOut />
						</Button>
					) : null}
					{showChart ? (
						<Button
							variant="ghost"
							size="icon-xs"
							onClick={() => void handleExport()}
							disabled={exporting}
							aria-label="Export chart as PNG"
							title="Export chart as PNG"
						>
							{exporting ? <Spinner /> : <DownloadSimple />}
						</Button>
					) : null}
				</div>
			</div>

			{showChart && resolution.ok ? (
				<Suspense
					fallback={
						<div className="flex h-60 items-center justify-center rounded-md bg-card">
							<Spinner />
						</div>
					}
				>
					<ResultChart
						spec={resolution.spec}
						dataset={dataset}
						containerRef={chartRef}
					/>
				</Suspense>
			) : (
				<>
					{dataset.rows.length > 0 ? (
						<ResultTable dataset={dataset} />
					) : (
						<p className="text-xs text-muted-foreground">No rows returned.</p>
					)}
					{dataset.rows.length > TABLE_PREVIEW_ROWS ? (
						<p className="text-[11px] text-muted-foreground">
							Showing the first {TABLE_PREVIEW_ROWS} rows.
						</p>
					) : null}
					{!resolution.ok && message.chart ? (
						<p className="text-[11px] text-muted-foreground">
							Chart not shown: {resolution.reason}
						</p>
					) : null}
				</>
			)}
		</div>
	);
}
