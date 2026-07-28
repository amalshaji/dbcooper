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
import { useEffect, useMemo, useState } from "react";
import { barf, rosePineDawn } from "thememirror";
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

	const fontTheme = useMemo(
		() =>
			EditorView.theme({
				"&": {
					fontFamily: "'Google Sans Code Variable', monospace",
				},
				".cm-content": {
					fontFamily: "'Google Sans Code Variable', monospace",
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
			fontTheme,
			EditorState.readOnly.of(disabled),
			EditorView.lineWrapping,
			cursorExtension,
		],
		[runQueryKeymap, sqlExtension, fontTheme, disabled, cursorExtension],
	);
	const draftExtensions = useMemo(
		() => [sqlExtension, fontTheme, EditorView.lineWrapping],
		[sqlExtension, fontTheme],
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
			{ai && aiDraft.status !== "idle" && (
				<SqlAIPreview
					draft={aiDraft}
					hasExistingSql={Boolean(value.trim())}
					onDraftChange={ai.onDraftChange}
					editorExtensions={draftExtensions}
					editorTheme={isDark ? barf : rosePineDawn}
					onDiscard={ai.onDiscard}
					onAppend={() => {
						if (aiDraft.status !== "ready") return;
						onChange(`${value.trimEnd()}\n\n${aiDraft.sql}`);
						ai.onDiscard();
					}}
					onReplace={() => {
						if (aiDraft.status !== "ready") return;
						onChange(aiDraft.sql);
						ai.onDiscard();
					}}
				/>
			)}
			<div
				className={`relative min-w-0 overflow-hidden rounded-md border font-mono${
					onRunQuery ? " flex flex-col" : ""
				}`}
				style={onRunQuery ? { height } : undefined}
			>
				<div
					className={`z-10 flex gap-1 ${
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
					{onRunQuery && (
						<div className="flex">
							<Button
								size="sm"
								onClick={onRunQuery}
								disabled={disabled || executing || !value.trim()}
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
												disabled={disabled || executing || !value.trim()}
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
				<CodeMirror
					value={value}
					height={onRunQuery ? "100%" : height}
					className={onRunQuery ? "min-h-0 flex-1" : undefined}
					width="100%"
					extensions={extensions}
					theme={isDark ? barf : rosePineDawn}
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
			</div>
		</div>
	);
}
