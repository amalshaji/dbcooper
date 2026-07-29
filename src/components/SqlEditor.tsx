import { type SQLConfig, sql } from "@codemirror/lang-sql";
import { EditorState, Prec } from "@codemirror/state";
import { EditorView, keymap } from "@codemirror/view";
import {
	CaretDown,
	PlayCircle,
	Sparkle,
	Warning,
	WarningCircle,
} from "@phosphor-icons/react";
import CodeMirror from "@uiw/react-codemirror";
import { type ReactNode, useEffect, useMemo, useState } from "react";
import { ayuLight, barf } from "thememirror";
import { SqlAIPreview } from "@/components/SqlAIPreview";
import { Button } from "@/components/ui/button";
import {
	DropdownMenu,
	DropdownMenuContent,
	DropdownMenuItem,
	DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import { Spinner } from "@/components/ui/spinner";
import {
	Tooltip,
	TooltipContent,
	TooltipTrigger,
} from "@/components/ui/tooltip";
import type { QueryAiState } from "@/lib/aiDraftState";

const emptyAiState: QueryAiState = {
	instruction: "",
	draft: { status: "idle" },
};

function appendSqlStatement(currentSql: string, draftSql: string): string {
	const current = currentSql.trimEnd();
	const draft = draftSql.trim();
	if (!current) return draft;
	if (!draft) return current;
	return `${current}${current.endsWith(";") ? "" : ";"}\n\n${draft}`;
}

interface TableSchema {
	schema: string;
	name: string;
	columns?: Array<{
		name: string;
		type: string;
		nullable: boolean;
	}>;
}

interface SqlEditorAiProps {
	state: QueryAiState;
	configured: boolean | null;
	onInstructionChange: (instruction: string) => void;
	onDraftChange: (sql: string) => void;
	onGenerate: () => Promise<void>;
	onDiscard: () => void;
}

interface SqlEditorProps {
	value: string;
	onChange: (value: string) => void;
	onRunQuery?: () => void;
	onRunAllQueries?: () => void;
	toolbarActions?: ReactNode;
	executing?: boolean;
	disabled?: boolean;
	height?: string;
	tables?: TableSchema[];
	ai?: SqlEditorAiProps;
	onCursorActivity?: (line: number, char: number) => void;
	cursorWarning?: string | null;
}

export function SqlEditor({
	value,
	onChange,
	onRunQuery,
	onRunAllQueries,
	toolbarActions,
	executing = false,
	height = "300px",
	tables = [],
	ai,
	onCursorActivity,
	cursorWarning = null,
	disabled = false,
}: SqlEditorProps) {
	const [isDark, setIsDark] = useState(false);
	const { instruction, draft: aiDraft } = ai?.state ?? emptyAiState;
	const generating = aiDraft.status === "generating";
	const reviewing = aiDraft.status === "ready";
	const framedEditor = Boolean(onRunQuery) || reviewing;

	useEffect(() => {
		const checkTheme = () => {
			const isDarkMode = document.documentElement.classList.contains("dark");
			setIsDark(isDarkMode);
		};

		checkTheme();
		const observer = new MutationObserver(checkTheme);
		observer.observe(document.documentElement, {
			attributes: true,
			attributeFilter: ["class"],
		});

		return () => observer.disconnect();
	}, []);

	const runQueryKeymap = useMemo(
		() =>
			Prec.highest(
				keymap.of([
					{
						key: "Mod-Enter",
						run: (view) => {
							if (
								onRunQuery &&
								!disabled &&
								!executing &&
								view.state.doc.toString().trim()
							) {
								onRunQuery();
								return true;
							}
							return false;
						},
					},
				]),
			),
		[onRunQuery, disabled, executing],
	);

	const editorChromeTheme = useMemo(
		() =>
			EditorView.theme({
				"&": {
					backgroundColor: "var(--background)",
					color: "var(--foreground)",
					fontFamily: "'Google Sans Code Variable', monospace",
				},
				".cm-content": {
					caretColor: "var(--primary)",
					fontFamily: "'Google Sans Code Variable', monospace",
				},
				".cm-cursor, .cm-dropCursor": {
					borderLeftColor: "var(--primary)",
				},
				"&.cm-focused .cm-selectionBackground, .cm-content ::selection": {
					backgroundColor:
						"color-mix(in oklch, var(--primary) 24%, transparent) !important",
				},
				".cm-activeLine": {
					backgroundColor:
						"color-mix(in oklch, var(--foreground) 4%, transparent)",
				},
				".cm-gutters": {
					backgroundColor:
						"color-mix(in oklch, var(--background) 96%, var(--foreground))",
					borderRight: "1px solid var(--border)",
					color: "var(--muted-foreground)",
				},
				".cm-activeLineGutter": {
					backgroundColor:
						"color-mix(in oklch, var(--foreground) 4%, transparent)",
					color: "var(--foreground)",
				},
			}),
		[],
	);

	const cursorExtension = useMemo(
		() =>
			EditorView.updateListener.of((update) => {
				if (update.selectionSet && onCursorActivity) {
					const pos = update.state.selection.main.head;
					const line = update.state.doc.lineAt(pos);
					onCursorActivity(line.number - 1, pos - line.from);
				}
			}),
		[onCursorActivity],
	);

	const sqlSchema = useMemo(() => {
		const schema: SQLConfig["schema"] = {};
		for (const table of tables) {
			const fullName = `${table.schema}.${table.name}`;
			const columns = table.columns?.map((col) => col.name) ?? [];
			schema[fullName] = columns;
			schema[table.name] = columns;
		}
		return schema;
	}, [tables]);

	const sqlExtension = useMemo(
		() =>
			sql({
				upperCaseKeywords: true,
				schema: sqlSchema,
			}),
		[sqlSchema],
	);

	const extensions = useMemo(
		() => [
			runQueryKeymap,
			sqlExtension,
			editorChromeTheme,
			EditorState.readOnly.of(disabled),
			EditorView.lineWrapping,
			cursorExtension,
		],
		[
			runQueryKeymap,
			sqlExtension,
			editorChromeTheme,
			disabled,
			cursorExtension,
		],
	);
	const draftExtensions = useMemo(
		() => [sqlExtension, editorChromeTheme, EditorView.lineWrapping],
		[sqlExtension, editorChromeTheme],
	);

	const handleGenerate = async () => {
		if (instruction.trim() && ai) await ai.onGenerate();
	};

	const isButtonDisabled =
		!instruction.trim() || generating || ai?.configured === false;

	return (
		<div className="space-y-2">
			{ai && (
				<div className="space-y-2">
					<div className="flex gap-1 rounded-lg border bg-muted/20 p-1 shadow-sm focus-within:border-ring">
						<Sparkle className="ml-2 mt-2 size-4 shrink-0 text-primary" />
						<Input
							placeholder={
								ai.configured === false
									? "Configure AI in Settings to enable generation"
									: "Ask for a query or change…"
							}
							value={instruction}
							onChange={(event) => ai.onInstructionChange(event.target.value)}
							onKeyDown={(event) => {
								if (
									event.key === "Enter" &&
									!generating &&
									ai.configured !== false
								)
									void handleGenerate();
							}}
							disabled={generating || ai.configured === false}
							className="h-8 flex-1 border-0 bg-transparent shadow-none focus-visible:ring-0"
						/>
						<Tooltip>
							<TooltipTrigger
								render={
									<Button
										onClick={() => void handleGenerate()}
										disabled={isButtonDisabled}
										className="whitespace-nowrap"
									/>
								}
							>
								{generating ? <Spinner /> : <Sparkle />}
								Generate draft
							</TooltipTrigger>
							{ai.configured === false && (
								<TooltipContent>
									Configure an AI provider in Settings
								</TooltipContent>
							)}
						</Tooltip>
					</div>
					<div className="flex items-center px-1 text-[11px] text-muted-foreground">
						<span>
							Context: current query · {tables.length} schema objects available
						</span>
						<div className="ml-auto flex items-center">
							{["Add a safe limit", "Fix this query", "Join related data"].map(
								(prompt) => (
									<Button
										key={prompt}
										variant="ghost"
										size="sm"
										className="h-6 px-2 text-[11px]"
										onClick={() => ai.onInstructionChange(prompt)}
										disabled={generating}
									>
										{prompt}
									</Button>
								),
							)}
						</div>
					</div>
				</div>
			)}
			{ai && aiDraft.status === "error" && (
				<div
					role="alert"
					className="flex items-center gap-2 rounded-md border border-destructive/20 bg-destructive/5 px-3 py-2 text-xs text-destructive"
				>
					<WarningCircle className="size-4 shrink-0" />
					<span className="min-w-0 flex-1 truncate">
						Couldn’t generate a draft. {aiDraft.message}
					</span>
					<Button variant="ghost" size="sm" onClick={ai.onDiscard}>
						Dismiss
					</Button>
				</div>
			)}
			<div
				data-testid="sql-editor-frame"
				className={`relative min-w-0 overflow-hidden rounded-md border font-mono${
					framedEditor ? " flex flex-col" : ""
				}`}
				style={framedEditor ? { height } : undefined}
			>
				<div
					className={`z-10 flex gap-1 font-sans ${
						onRunQuery
							? "shrink-0 items-center justify-between border-b bg-muted/20 px-2 py-1"
							: "absolute top-2 right-2"
					}`}
				>
					<div className="flex items-center gap-1">
						{cursorWarning && (
							<Tooltip>
								<TooltipTrigger
									render={
										<div className="cursor-pointer">
											<Warning
												className="w-5 h-5 text-amber-500"
												weight="fill"
											/>
										</div>
									}
								/>
								<TooltipContent>
									<p>{cursorWarning}</p>
								</TooltipContent>
							</Tooltip>
						)}
						{value.trim() === "" && (
							<Tooltip>
								<TooltipTrigger
									render={
										<div className="cursor-pointer">
											<WarningCircle
												className="w-5 h-5 text-red-500"
												weight="fill"
											/>
										</div>
									}
								/>
								<TooltipContent>
									<p>Query is empty - cannot execute</p>
								</TooltipContent>
							</Tooltip>
						)}
					</div>
					{(toolbarActions || onRunQuery) && (
						<div className="flex items-center gap-2">
							{toolbarActions}
							{onRunQuery && (
								<div className="flex">
									<Button
										size="sm"
										onClick={onRunQuery}
										disabled={
											disabled || reviewing || executing || !value.trim()
										}
										className="rounded-r-none border-r-0 -mr-1"
									>
										{executing ? <Spinner /> : null}
										Run query{" "}
										<span className="text-xs opacity-60">
											({navigator.platform.includes("Mac") ? "⌘" : "Ctrl"}+↵)
										</span>
									</Button>
									{onRunAllQueries && (
										<DropdownMenu>
											<DropdownMenuTrigger
												render={
													<Button
														size="sm"
														className="rounded-l-none border border-border px-1"
														disabled={
															disabled ||
															reviewing ||
															executing ||
															!value.trim()
														}
													>
														<CaretDown className="w-4 h-4" />
													</Button>
												}
											/>
											<DropdownMenuContent align="end">
												<DropdownMenuItem onClick={onRunAllQueries}>
													<PlayCircle className="w-4 h-4" />
													Run all queries
												</DropdownMenuItem>
											</DropdownMenuContent>
										</DropdownMenu>
									)}
								</div>
							)}
						</div>
					)}
				</div>
				{ai && reviewing ? (
					<SqlAIPreview
						draft={aiDraft}
						currentSql={value}
						onDraftChange={ai.onDraftChange}
						embedded
						editorHeight="100%"
						editorExtensions={draftExtensions}
						editorTheme={isDark ? barf : ayuLight}
						onDiscard={ai.onDiscard}
						onAppend={() => {
							onChange(appendSqlStatement(value, aiDraft.sql));
							ai.onDiscard();
						}}
						onReplace={() => {
							onChange(aiDraft.sql);
							ai.onDiscard();
						}}
					/>
				) : (
					<CodeMirror
						value={value}
						height={framedEditor ? "100%" : height}
						className={framedEditor ? "min-h-0 flex-1" : undefined}
						width="100%"
						extensions={extensions}
						theme={isDark ? barf : ayuLight}
						onChange={onChange}
						editable={!disabled}
						basicSetup={{
							lineNumbers: true,
							foldGutter: true,
							dropCursor: false,
							allowMultipleSelections: false,
							indentOnInput: true,
							bracketMatching: true,
							closeBrackets: true,
							autocompletion: true,
							highlightSelectionMatches: false,
						}}
					/>
				)}
			</div>
		</div>
	);
}
