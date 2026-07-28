import { Check, Sparkle, WarningCircle, X } from "@phosphor-icons/react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Spinner } from "@/components/ui/spinner";
import type { QueryAiState } from "@/lib/aiDraftState";

interface MongoAiAssistantProps {
	state: QueryAiState;
	configured: boolean | null;
	available: boolean;
	context: string;
	onInstructionChange: (instruction: string) => void;
	onGenerate: () => void;
	onUse: () => void;
	onDiscard: () => void;
}

export function MongoAiAssistant({
	state,
	configured,
	available,
	context,
	onInstructionChange,
	onGenerate,
	onUse,
	onDiscard,
}: MongoAiAssistantProps) {
	const generating = state.draft.status === "generating";
	const query =
		state.draft.status === "generating" || state.draft.status === "ready"
			? state.draft.sql
			: "";
	const disabled =
		!available ||
		!state.instruction.trim() ||
		generating ||
		configured !== true;

	return (
		<section className="border-b bg-card/70 px-3 py-2 backdrop-blur-xl">
			<div className="flex items-center gap-2">
				<Sparkle className="size-4 shrink-0 text-emerald-600 dark:text-emerald-400" />
				<Input
					className="h-8 min-w-0 flex-1 border-0 bg-transparent shadow-none focus-visible:ring-0"
					placeholder={
						!available
							? "Select a collection to generate a query"
							: configured === false
								? "Configure AI in Settings to generate MongoDB queries"
								: "Ask for a MongoDB query…"
					}
					value={state.instruction}
					disabled={!available || generating || configured !== true}
					onChange={(event) => onInstructionChange(event.target.value)}
					onKeyDown={(event) => {
						if (event.key === "Enter" && !disabled) onGenerate();
					}}
				/>
				<span className="hidden truncate text-[11px] text-muted-foreground xl:block">
					{context}
				</span>
				<Button size="sm" onClick={onGenerate} disabled={disabled}>
					{generating ? <Spinner /> : <Sparkle />}
					Generate draft
				</Button>
			</div>
			<div className="mt-1 flex items-center gap-1 pl-6">
				{[
					"Find active documents",
					"Project selected fields",
					"Build an aggregation",
				].map((prompt) => (
					<Button
						key={prompt}
						variant="ghost"
						size="xs"
						className="text-[11px] text-muted-foreground"
						disabled={!available || generating || configured !== true}
						onClick={() => onInstructionChange(prompt)}
					>
						{prompt}
					</Button>
				))}
			</div>
			{state.draft.status !== "idle" && (
				<div className="mt-2 overflow-hidden rounded-lg border border-emerald-500/20 bg-emerald-500/[0.035]">
					<div className="flex items-center gap-1.5 border-b border-emerald-500/15 px-3 py-1.5 text-xs font-medium">
						{generating ? (
							<Spinner className="size-3.5" />
						) : state.draft.status === "error" ? (
							<WarningCircle className="size-3.5 text-destructive" />
						) : (
							<Sparkle className="size-3.5 text-emerald-600 dark:text-emerald-400" />
						)}
						AI query draft
						<span className="ml-auto text-[10px] font-normal text-muted-foreground">
							Not executed
						</span>
					</div>
					<pre className="max-h-32 overflow-auto whitespace-pre-wrap px-3 py-2 font-mono text-xs leading-5">
						{state.draft.status === "error"
							? `Couldn’t generate a draft. ${state.draft.message}`
							: query || "Preparing a query from the current collection…"}
					</pre>
					{!generating && (
						<div className="flex justify-end border-t border-emerald-500/15 px-2 py-1.5">
							<Button variant="ghost" size="sm" onClick={onDiscard}>
								<X /> Discard
							</Button>
							{state.draft.status === "ready" && (
								<Button size="sm" onClick={onUse} disabled={!query.trim()}>
									<Check /> Use query
								</Button>
							)}
						</div>
					)}
				</div>
			)}
		</section>
	);
}
