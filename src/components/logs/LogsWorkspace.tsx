import { Warning } from "@phosphor-icons/react";
import { useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import {
	Select,
	SelectContent,
	SelectItem,
	SelectTrigger,
	SelectValue,
} from "@/components/ui/select";
import { Spinner } from "@/components/ui/spinner";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import type { ObservabilityMode } from "@/lib/logs";
import {
	useObservabilityCapabilities,
	useObservabilityStream,
} from "@/hooks/useObservabilityStream";
import type { Connection } from "@/types/connection";
import { LogViewer } from "./LogViewer";

export function LogsWorkspace({ connection }: { connection: Connection }) {
	const [mode, setMode] = useState<ObservabilityMode>("logs");
	const [requestedSource, setRequestedSource] = useState<string | null>(null);
	const capabilities = useObservabilityCapabilities(connection.uuid);
	const modeSources = useMemo(
		() => capabilities.capabilities.filter((capability) =>
			capability.modes.includes(mode),
		),
		[capabilities.capabilities, mode],
	);
	const selectedCapability =
		modeSources.find((capability) => capability.id === requestedSource) ??
		modeSources.find((capability) => capability.availability !== "unavailable") ??
		modeSources[0] ??
		null;
	const source = selectedCapability?.id ?? null;

	const stream = useObservabilityStream({
		connectionUuid: connection.uuid,
		mode,
		source,
		enabled:
			!capabilities.loading &&
			selectedCapability?.availability !== "unavailable" &&
			Boolean(selectedCapability),
	});
	const changeMode = (nextMode: string) => {
		setMode(nextMode as ObservabilityMode);
		setRequestedSource(null);
	};
	const changeSource = (nextSource: string | null) => {
		setRequestedSource(nextSource);
	};

	return (
		<div className="workspace-panel flex h-full min-h-0 flex-col overflow-hidden rounded-lg">
		<header className="toolbar-material flex min-h-11 flex-wrap items-center gap-2 border-b px-2 py-1.5">
			<Tabs value={mode} onValueChange={changeMode}>
				<TabsList className="h-8">
					<TabsTrigger value="logs" className="text-xs">
						Logs
					</TabsTrigger>
					<TabsTrigger value="activity" className="text-xs">
						Activity
					</TabsTrigger>
				</TabsList>
			</Tabs>
			<div className="h-5 border-l" aria-hidden="true" />
			<label htmlFor="observability-source" className="section-label">
				Source
			</label>
			{capabilities.loading ? (
				<div className="flex h-8 min-w-44 items-center text-xs text-muted-foreground">
					<Spinner className="size-3.5" />
					Checking sources
				</div>
			) : modeSources.length > 0 ? (
				<Select
					value={source ?? undefined}
					onValueChange={changeSource}
				>
					<SelectTrigger id="observability-source" size="sm" className="min-w-48">
						<SelectValue />
					</SelectTrigger>
					<SelectContent align="start">
						{modeSources.map((capability) => (
							<SelectItem
								key={capability.id}
								value={capability.id}
								disabled={capability.availability === "unavailable"}
							>
								<span>{capability.label}</span>
								<span className="ml-auto text-[0.625rem] text-muted-foreground">
									{capability.availability}
								</span>
							</SelectItem>
						))}
					</SelectContent>
				</Select>
			) : (
				<span className="text-xs text-muted-foreground">No source available</span>
			)}
			{selectedCapability?.availability === "degraded" ? (
				<span className="flex min-w-0 items-center text-xs text-amber-700 dark:text-amber-300">
					<Warning className="mr-1 size-3.5 shrink-0" />
					{selectedCapability.reason ?? "This source has limited availability."}
				</span>
			) : null}
		</header>

		{capabilities.error ? (
			<div role="alert" className="flex flex-1 flex-col items-center justify-center px-6 text-center">
				<p className="text-sm font-medium">Could not inspect log sources</p>
				<p className="mt-1 max-w-lg text-xs text-muted-foreground">
					{capabilities.error}
				</p>
				<Button className="mt-3" variant="outline" size="sm" onClick={() => void capabilities.refresh()}>
					Check again
				</Button>
			</div>
		) : !capabilities.loading &&
		  (!selectedCapability || selectedCapability.availability === "unavailable") ? (
			<div role="status" className="flex flex-1 flex-col items-center justify-center px-6 text-center">
				<p className="text-sm font-medium">
					{mode === "logs" ? "Logs are unavailable" : "Activity is unavailable"}
				</p>
				<p className="mt-1 max-w-lg text-xs text-muted-foreground">
					{selectedCapability?.reason ??
						`This connection does not expose live ${mode} to DBcooper.`}
				</p>
			</div>
		) : (
			<LogViewer
				key={`${mode}:${source ?? "none"}`}
				mode={mode}
				entries={stream.entries}
				status={stream.status}
				error={stream.error}
				onClear={stream.clear}
				onRetry={stream.retry}
			/>
		)}
	</div>
	);
}
