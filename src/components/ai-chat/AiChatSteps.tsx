import { CaretRight, Database, Eye, WarningCircle } from "@phosphor-icons/react";
import {
	Collapsible,
	CollapsibleContent,
	CollapsibleTrigger,
} from "@/components/ui/collapsible";
import { Spinner } from "@/components/ui/spinner";
import type { AiChatStep, AiInspectLevel } from "@/lib/tauri/aiChat";

const INSPECT_LABEL: Record<AiInspectLevel, string> = {
	none: "AI saw only the result shape",
	summary: "AI saw column summaries, not values",
	rows: "AI saw up to 50 sample rows",
};

function stepLabel(step: AiChatStep) {
	if (step.purpose) return step.purpose;
	return step.kind === "describe" ? `Looked up ${step.query}` : "Ran a query";
}

function stepMeta(step: AiChatStep) {
	if (step.running || step.error) return null;
	const parts: string[] = [];
	if (step.row_count !== null) {
		parts.push(
			`${step.row_count.toLocaleString()}${step.truncated ? "+" : ""} rows`,
		);
	}
	if (step.duration_ms !== null) parts.push(`${step.duration_ms} ms`);
	return parts.join(" · ");
}

function StepIcon({ step }: { step: AiChatStep }) {
	if (step.running) return <Spinner className="size-3.5" />;
	if (step.error)
		return <WarningCircle className="size-3.5 shrink-0 text-destructive" />;
	return <Database className="size-3.5 shrink-0" />;
}

export function AiChatSteps({ steps }: { steps: AiChatStep[] }) {
	if (steps.length === 0) return null;
	return (
		<ol className="space-y-0.5">
			{steps.map((step) => (
				<li key={step.id}>
					<Collapsible>
						<CollapsibleTrigger className="group flex w-full items-center gap-2 rounded-md px-1.5 py-1 text-left text-xs text-muted-foreground outline-none hover:bg-muted/60 focus-visible:ring-2 focus-visible:ring-ring/50">
							<StepIcon step={step} />
							<span className="min-w-0 flex-1 truncate">{stepLabel(step)}</span>
							<span className="shrink-0 text-[11px] tabular-nums">
								{stepMeta(step)}
							</span>
							<CaretRight className="size-3 shrink-0 transition-transform group-data-[panel-open]:rotate-90" />
						</CollapsibleTrigger>
						<CollapsibleContent className="px-1.5 pb-1">
							<pre className="mt-1 max-h-48 overflow-auto whitespace-pre-wrap break-words rounded-md bg-muted/50 p-2 font-mono text-[11px]">
								{step.query}
							</pre>
							{step.inspect ? (
								<p className="mt-1 flex items-center gap-1 text-[11px] text-muted-foreground">
									<Eye className="size-3" />
									{INSPECT_LABEL[step.inspect]}
								</p>
							) : null}
							{step.error ? (
								<p className="mt-1 text-[11px] text-destructive">{step.error}</p>
							) : null}
						</CollapsibleContent>
					</Collapsible>
				</li>
			))}
		</ol>
	);
}
