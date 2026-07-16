import { useMemo, useEffect, useState, useRef } from "react";
import CodeMirror from "@uiw/react-codemirror";
import { sql, type SQLConfig } from "@codemirror/lang-sql";
import { rosePineDawn, barf } from "thememirror";
import { keymap } from "@codemirror/view";
import { EditorView } from "@codemirror/view";
import { EditorState, Prec } from "@codemirror/state";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Sparkle, Warning, WarningCircle } from "@phosphor-icons/react";
import { Spinner } from "@/components/ui/spinner";
import {
	Tooltip,
	TooltipContent,
	TooltipTrigger,
} from "@/components/ui/tooltip";
import { SqlAIPreview } from "@/components/SqlAIPreview";

interface TableSchema {
	schema: string;
	name: string;
	columns?: Array<{
		name: string;
		type: string;
		nullable: boolean;
	}>;
}

interface SqlEditorProps {
	value: string;
	onChange: (value: string) => void;
	onRunQuery?: () => void;
	disabled?: boolean;
	height?: string;
	tables?: TableSchema[];
	onGenerateSQL?: (
		instruction: string,
		existingSQL: string,
		onPreview: (sql: string) => void,
	) => Promise<void>;
	generating?: boolean;
	aiConfigured?: boolean | null;
	onCursorActivity?: (line: number, char: number) => void;
	cursorWarning?: string | null;
}

export function SqlEditor({
	value,
	onChange,
	onRunQuery,
	height = "300px",
	tables = [],
	onGenerateSQL,
	generating = false,
	aiConfigured = null,
	onCursorActivity,
	cursorWarning = null,
	disabled = false,
}: SqlEditorProps) {
	const [isDark, setIsDark] = useState(false);
	const [containerWidth, setContainerWidth] = useState<number | null>(null);
	const [instruction, setInstruction] = useState("");
	const [aiPreview, setAiPreview] = useState<string | null>(null);
	const containerRef = useRef<HTMLDivElement>(null);

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

	useEffect(() => {
		const updateWidth = () => {
			if (containerRef.current) {
				const width = containerRef.current.offsetWidth;
				setContainerWidth(width);
			}
		};

		updateWidth();
		window.addEventListener("resize", updateWidth);

		return () => window.removeEventListener("resize", updateWidth);
	}, []);

	const runQueryKeymap = useMemo(
		() =>
			Prec.highest(
				keymap.of([
					{
						key: "Mod-Enter",
						run: (view) => {
							if (onRunQuery && !disabled && view.state.doc.toString().trim()) {
								onRunQuery();
								return true;
							}
							return false;
						},
					},
				]),
			),
		[onRunQuery, disabled],
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

	const handleGenerate = async () => {
		if (instruction.trim() && onGenerateSQL) {
			setAiPreview("");
			await onGenerateSQL(instruction, value, setAiPreview);
		}
	};

	const isButtonDisabled =
		!instruction.trim() || generating || aiConfigured === false;

	return (
		<div className="space-y-2">
			{onGenerateSQL && tables.length > 0 && (
				<div className="space-y-2">
					<div className="flex gap-1 rounded-xl border bg-muted/20 p-1 shadow-sm focus-within:border-ring">
						<Sparkle className="ml-2 mt-2 size-4 shrink-0 text-primary" />
						<Input
							placeholder={
								aiConfigured === false
									? "Configure AI in Settings to enable generation"
									: "Ask for a query or change…"
							}
							value={instruction}
							onChange={(event) => setInstruction(event.target.value)}
							onKeyDown={(event) => {
								if (
									event.key === "Enter" &&
									!generating &&
									aiConfigured !== false
								)
									void handleGenerate();
							}}
							disabled={generating || aiConfigured === false}
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
							{aiConfigured === false && (
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
										onClick={() => setInstruction(prompt)}
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
			{aiPreview !== null && (
				<SqlAIPreview
					sql={aiPreview}
					hasExistingSql={Boolean(value.trim())}
					generating={generating}
					onDiscard={() => setAiPreview(null)}
					onAppend={() => {
						onChange(`${value.trimEnd()}\n\n${aiPreview}`);
						setAiPreview(null);
					}}
					onReplace={() => {
						onChange(aiPreview);
						setAiPreview(null);
					}}
				/>
			)}
			<div
				ref={containerRef}
				className="border rounded-md overflow-hidden w-full font-mono relative"
			>
				<div className="absolute top-2 right-2 z-10 flex gap-1">
					{cursorWarning && (
						<Tooltip>
							<TooltipTrigger
								render={
									<div className="cursor-pointer">
										<Warning className="w-5 h-5 text-amber-500" weight="fill" />
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
				<div className="overflow-x-auto">
					<CodeMirror
						value={value}
						height={height}
						width={containerWidth ? `${containerWidth}px` : "100%"}
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
		</div>
	);
}
