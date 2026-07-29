import { Sparkle } from "@phosphor-icons/react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Spinner } from "@/components/ui/spinner";
import {
	Tooltip,
	TooltipContent,
	TooltipTrigger,
} from "@/components/ui/tooltip";
import type { SqlEditScope, SqlSelection } from "@/lib/aiDraftState";

const QUICK_PROMPTS = [
	"Add a safe limit",
	"Fix this query",
	"Join related data",
];

interface SqlAiPromptProps {
	value: string;
	instruction: string;
	selection?: SqlSelection;
	tableCount: number;
	configured: boolean | null;
	generating: boolean;
	onInstructionChange: (instruction: string) => void;
	onGenerate: (scope: SqlEditScope) => Promise<void>;
}

export function SqlAiPrompt({
	value,
	instruction,
	selection,
	tableCount,
	configured,
	generating,
	onInstructionChange,
	onGenerate,
}: SqlAiPromptProps) {
	const generate = () => {
		if (!instruction.trim()) return;
		const scope: SqlEditScope = selection
			? { kind: "selection", sql: value, selection }
			: { kind: "query", sql: value };
		void onGenerate(scope);
	};
	const disabled = !instruction.trim() || generating || configured === false;

	return (
		<div className="space-y-2">
			<div className="flex gap-1 rounded-lg border bg-muted/20 p-1 shadow-sm focus-within:border-ring">
				<Sparkle className="ml-2 mt-2 size-4 shrink-0 text-primary" />
				<Input
					placeholder={
						configured === false
							? "Configure AI in Settings to enable generation"
							: selection
								? "Ask AI to improve selected SQL…"
								: "Ask for a query or change…"
					}
					value={instruction}
					onChange={(event) => onInstructionChange(event.target.value)}
					onKeyDown={(event) => {
						if (event.key === "Enter" && !disabled) generate();
					}}
					disabled={generating || configured === false}
					className="h-8 flex-1 border-0 bg-transparent shadow-none focus-visible:ring-0"
				/>
				<Tooltip>
					<TooltipTrigger
						render={
							<Button
								onClick={generate}
								disabled={disabled}
								className="whitespace-nowrap"
							/>
						}
					>
						{generating ? <Spinner /> : <Sparkle />}
						{selection ? "Improve selection" : "Generate draft"}
					</TooltipTrigger>
					{configured === false && (
						<TooltipContent>Configure an AI provider in Settings</TooltipContent>
					)}
				</Tooltip>
			</div>
			<div className="flex items-center px-1 text-[11px] text-muted-foreground">
				<span>
					Context: {selection ? "selected SQL · full query" : "current query"} ·{" "}
					{tableCount} schema objects available
				</span>
				<div className="ml-auto flex items-center">
					{QUICK_PROMPTS.map((prompt) => (
						<Button
							key={prompt}
							variant="ghost"
							size="sm"
							className="h-6 px-2 text-[11px]"
							onClick={() => onInstructionChange(prompt)}
							disabled={generating}
						>
							{prompt}
						</Button>
					))}
				</div>
			</div>
		</div>
	);
}
