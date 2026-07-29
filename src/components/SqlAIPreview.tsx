import type { Extension } from "@codemirror/state";
import { Check, Plus, Sparkle, X } from "@phosphor-icons/react";
import CodeMirror from "@uiw/react-codemirror";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import type { AiDraftState } from "@/lib/aiDraftState";
import type { AiDraftApplyMode, AiDraftReview } from "@/lib/sqlAiDraft";
import { cn } from "@/lib/utils";

interface SqlAIPreviewProps {
	draft: Extract<AiDraftState, { status: "ready" }>;
	review: AiDraftReview;
	onApply: (mode: AiDraftApplyMode) => void;
	onDiscard: () => void;
	onDraftChange: (sql: string) => void;
	embedded?: boolean;
	editorHeight?: string;
	editorExtensions?: Extension[];
	editorTheme?: Extension;
}

export function SqlAIPreview({
	draft,
	review,
	onApply,
	onDiscard,
	onDraftChange,
	embedded = false,
	editorHeight = "300px",
	editorExtensions = [],
	editorTheme,
}: SqlAIPreviewProps) {
	const [version, setVersion] = useState<"current" | "draft">("draft");
	const showingCurrent = version === "current";

	return (
		<section
			aria-label="Review AI draft"
			className={cn(
				"overflow-hidden font-sans",
				embedded
					? "flex min-h-0 flex-1 flex-col border-0 bg-transparent shadow-none"
					: "rounded-lg border border-primary/20 bg-primary/[0.035] shadow-sm",
			)}
		>
			<header className="grid shrink-0 grid-cols-1 items-center gap-2 border-b border-primary/10 px-3 py-2 md:grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)]">
				<div className="flex min-w-0 items-center gap-2 text-xs">
					<span className="flex shrink-0 items-center gap-1.5 font-medium">
						<Sparkle className="size-3.5 text-primary" />
						Review AI draft
					</span>
					<span className="truncate border-l pl-2 text-muted-foreground">
						{review.preservationLabel}
					</span>
				</div>
				<div
					className="flex rounded-md border bg-muted/30 p-0.5"
					role="group"
					aria-label="SQL version"
				>
					<Button
						type="button"
						variant="ghost"
						size="sm"
						aria-pressed={showingCurrent}
						onClick={() => setVersion("current")}
						className={cn(
							"h-6 rounded-sm px-3 text-[11px]",
							showingCurrent && "bg-background shadow-sm hover:bg-background",
						)}
					>
						{review.currentVersionLabel}
					</Button>
					<Button
						type="button"
						variant="ghost"
						size="sm"
						aria-pressed={!showingCurrent}
						onClick={() => setVersion("draft")}
						className={cn(
							"h-6 rounded-sm px-3 text-[11px]",
							!showingCurrent && "bg-background shadow-sm hover:bg-background",
						)}
					>
						AI draft
					</Button>
				</div>
				<div className="flex items-center justify-end gap-1">
					<Button variant="ghost" size="sm" onClick={onDiscard}>
						<X /> Discard
					</Button>
					<Button variant="ghost" size="sm" onClick={() => onApply("append")}>
						<Plus /> Append
					</Button>
					<Button
						size="sm"
						onClick={() => onApply("replace")}
						disabled={!review.replace.enabled}
						title={
							review.replace.enabled ? undefined : review.replace.reason
						}
					>
						<Check /> Use in editor
					</Button>
				</div>
			</header>
			<div
				className={cn(
					"relative min-w-0 bg-background font-mono",
					embedded && "min-h-0 flex-1",
				)}
			>
				<CodeMirror
					aria-label={showingCurrent ? "Current SQL query" : "AI draft SQL"}
					value={showingCurrent ? review.currentSql : draft.sql}
					height={embedded ? "100%" : editorHeight}
					width="100%"
					extensions={editorExtensions}
					theme={editorTheme}
					onChange={(sql) => {
						if (!showingCurrent) onDraftChange(sql);
					}}
					editable={!showingCurrent}
					readOnly={showingCurrent}
					placeholder={
						showingCurrent
							? "No SQL in the current editor"
							: "AI draft is empty"
					}
					basicSetup={{
						lineNumbers: true,
						foldGutter: false,
						dropCursor: false,
						allowMultipleSelections: false,
						indentOnInput: true,
						bracketMatching: true,
						closeBrackets: true,
						autocompletion: false,
						highlightSelectionMatches: false,
					}}
				/>
			</div>
		</section>
	);
}
