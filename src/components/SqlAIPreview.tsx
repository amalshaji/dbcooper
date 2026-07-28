import type { Extension } from "@codemirror/state";
import { parseDiffFromFile } from "@pierre/diffs";
import { FileDiff } from "@pierre/diffs/react";
import { Check, Sparkle, WarningCircle, X } from "@phosphor-icons/react";
import CodeMirror from "@uiw/react-codemirror";
import { useMemo } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Spinner } from "@/components/ui/spinner";
import type { AiDraftState } from "@/lib/aiDraftState";
import { classifySqlIntent } from "@/lib/sqlSafety";
import { cn } from "@/lib/utils";

interface SqlAIPreviewProps {
	draft: Exclude<AiDraftState, { status: "idle" }>;
	onReplace: () => void;
	onDiscard: () => void;
	onDraftChange: (sql: string) => void;
	dark?: boolean;
	editorExtensions?: Extension[];
	editorTheme?: Extension;
}

export function SqlAIPreview({
	draft,
	onReplace,
	onDiscard,
	onDraftChange,
	dark = false,
	editorExtensions = [],
	editorTheme,
}: SqlAIPreviewProps) {
	const generating = draft.status === "generating";
	const sql = draft.status === "error" ? "" : draft.sql;
	const originalSql = draft.status === "error" ? "" : draft.originalSql;
	const hasDraft = Boolean(sql.trim());
	const showEditor = !generating || hasDraft;
	const showDiff = Boolean(originalSql.trim());
	const fileDiff = useMemo(
		() =>
			showDiff && hasDraft
				? parseDiffFromFile(
						{ name: "query.sql", contents: originalSql },
						{ name: "query.sql", contents: sql },
					)
				: null,
		[hasDraft, originalSql, showDiff, sql],
	);
	const additions =
		fileDiff?.hunks.reduce((total, hunk) => total + hunk.additionLines, 0) ?? 0;
	const deletions =
		fileDiff?.hunks.reduce((total, hunk) => total + hunk.deletionLines, 0) ?? 0;
	const intent = classifySqlIntent(sql);
	const intentLabel =
		intent === "read"
			? "Read only"
			: intent === "write"
				? "Writes data"
				: "Checking intent";

	return (
		<section className="overflow-hidden rounded-lg border border-primary/20 bg-primary/[0.035] shadow-sm">
			<header
				className={cn(
					"flex items-center justify-between px-3 py-2",
					showEditor && "border-b border-primary/10",
				)}
			>
				<div className="flex items-center gap-1.5 text-xs font-medium">
					{generating ? (
						<Spinner className="size-3.5" />
					) : draft.status === "error" ? (
						<WarningCircle className="size-3.5 text-destructive" />
					) : (
						<Sparkle className="size-3.5 text-primary" />
					)}
					{showDiff ? "AI changes" : "AI Draft"}
					{fileDiff && (
						<>
							<Badge
								variant="outline"
								className="border-emerald-500/20 bg-emerald-500/10 text-[10px] font-normal text-emerald-600 dark:text-emerald-400"
							>
								{additions} {additions === 1 ? "addition" : "additions"}
							</Badge>
							<Badge
								variant="outline"
								className="border-destructive/20 bg-destructive/10 text-[10px] font-normal text-destructive"
							>
								{deletions} {deletions === 1 ? "removal" : "removals"}
							</Badge>
						</>
					)}
				</div>
				{generating && (
					<span role="status" className="text-[11px] text-muted-foreground">
						Composing query…
					</span>
				)}
				{draft.status === "ready" && hasDraft && showDiff && (
					<div className="flex items-center gap-1">
						<Button variant="ghost" size="sm" onClick={onDiscard}>
							<X /> Discard
						</Button>
						<Button size="sm" onClick={onReplace}>
							<Check /> Accept changes
						</Button>
					</div>
				)}
				{draft.status === "ready" && hasDraft && !showDiff && (
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
			) : fileDiff ? (
				<div className="max-h-[300px] overflow-auto bg-background/40 font-mono text-xs">
					<FileDiff
						fileDiff={fileDiff}
						disableWorkerPool
						options={{
							diffStyle: "unified",
							diffIndicators: "classic",
							disableFileHeader: true,
							hunkSeparators: "metadata",
							lineDiffType: "word-alt",
							overflow: "wrap",
							themeType: dark ? "dark" : "light",
						}}
					/>
				</div>
			) : showEditor ? (
				<div className="relative min-w-0 bg-background/40 font-mono">
					<CodeMirror
						aria-label="AI SQL draft"
						aria-busy={generating}
						value={sql}
						minHeight={generating ? "72px" : "96px"}
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
				</div>
			) : null}
			{!generating && !showDiff && (
				<footer className="flex items-center justify-end border-t border-primary/10 bg-background/50 px-2 py-2">
					<Button
						variant="ghost"
						size="sm"
						onClick={onDiscard}
						disabled={generating}
					>
						<X /> Discard
					</Button>
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
