import type { Extension } from "@codemirror/state";
import { Check, Plus, Sparkle, WarningCircle, X } from "@phosphor-icons/react";
import CodeMirror from "@uiw/react-codemirror";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Spinner } from "@/components/ui/spinner";
import type { AiDraftState } from "@/lib/aiDraftState";
import { classifySqlIntent } from "@/lib/sqlSafety";

interface SqlAIPreviewProps {
	draft: Exclude<AiDraftState, { status: "idle" }>;
	hasExistingSql: boolean;
	onReplace: () => void;
	onAppend: () => void;
	onDiscard: () => void;
	onDraftChange: (sql: string) => void;
	editorExtensions?: Extension[];
	editorTheme?: Extension;
}

export function SqlAIPreview({
	draft,
	hasExistingSql,
	onReplace,
	onAppend,
	onDiscard,
	onDraftChange,
	editorExtensions = [],
	editorTheme,
}: SqlAIPreviewProps) {
	const generating = draft.status === "generating";
	const sql = draft.status === "error" ? "" : draft.sql;
	const hasDraft = Boolean(sql.trim());
	const intent = classifySqlIntent(sql);
	const intentLabel =
		intent === "read"
			? "Read only"
			: intent === "write"
				? "Writes data"
				: "Checking intent";

	return (
		<section className="overflow-hidden rounded-lg border border-primary/20 bg-primary/[0.035] shadow-sm">
			<header className="flex items-center justify-between border-b border-primary/10 px-3 py-2">
				<div className="flex items-center gap-1.5 text-xs font-medium">
					{generating ? (
						<Spinner className="size-3.5" />
					) : draft.status === "error" ? (
						<WarningCircle className="size-3.5 text-destructive" />
					) : (
						<Sparkle className="size-3.5 text-primary" />
					)}
					AI Draft
				</div>
				{generating && (
					<span className="text-[10px] text-muted-foreground">Not executed</span>
				)}
				{draft.status === "ready" && hasDraft && (
					<div className="flex items-center">
						<Badge
							variant="outline"
							className={
								intent === "write"
									? "border-destructive/30 bg-destructive/5 text-[10px] font-normal text-destructive"
									: "border-primary/20 bg-background/70 text-[10px] font-normal"
							}
						>
							{intentLabel}
						</Badge>
						<Badge
							variant="outline"
							className="border-primary/20 bg-background/70 text-[10px] font-normal"
						>
							Not executed
						</Badge>
					</div>
				)}
			</header>
			{draft.status === "error" ? (
				<p className="px-3 py-3 text-xs leading-5 text-destructive">
					Couldn’t generate a draft. {draft.message}
				</p>
			) : (
				<div className="relative min-w-0 bg-background/40 font-mono">
					<CodeMirror
						aria-label="AI SQL draft"
						aria-busy={generating}
						value={sql}
						minHeight="96px"
						maxHeight="192px"
						width="100%"
						extensions={editorExtensions}
						theme={editorTheme}
						onChange={(nextSql) => {
							if (!generating) onDraftChange(nextSql);
						}}
						editable={!generating}
						readOnly={generating}
						placeholder="Preparing a query from the current editor and schema…"
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
					{generating && (
						<div
							role="status"
							className="pointer-events-none absolute bottom-3 right-3 rounded bg-background/80 px-2 py-1 text-[11px] text-muted-foreground shadow-sm"
						>
							Composing query…
						</div>
					)}
				</div>
			)}
			{!generating && (
				<footer className="flex items-center justify-end border-t border-primary/10 bg-background/50 px-2 py-2">
					<Button
						variant="ghost"
						size="sm"
						onClick={onDiscard}
						disabled={generating}
					>
						<X /> Discard
					</Button>
					{draft.status === "ready" && hasExistingSql && (
						<Button
							variant="ghost"
							size="sm"
							onClick={onAppend}
							disabled={generating || !sql}
						>
							<Plus /> Append
						</Button>
					)}
					{draft.status === "ready" && (
						<Button size="sm" onClick={onReplace} disabled={!sql}>
							<Check /> Use in editor
						</Button>
					)}
				</footer>
			)}
		</section>
	);
}
