import { type SQLConfig, sql } from "@codemirror/lang-sql";
import { EditorState, Prec } from "@codemirror/state";
import { EditorView, keymap } from "@codemirror/view";
import { WarningCircle } from "@phosphor-icons/react";
import CodeMirror from "@uiw/react-codemirror";
import {
	type ReactNode,
	useCallback,
	useEffect,
	useMemo,
	useState,
} from "react";
import { ayuLight, barf } from "thememirror";
import { SqlAiPrompt } from "./SqlAiPrompt";
import { SqlAIPreview } from "@/components/SqlAIPreview";
import { SqlEditorToolbar } from "./SqlEditorToolbar";
import { Button } from "@/components/ui/button";
import type {
	QueryAiState,
	SqlEditScope,
	SqlSelection,
} from "@/lib/aiDraftState";
import type { AiDraftApplyMode, AiDraftReview } from "@/lib/sqlAiDraft";

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
	review: AiDraftReview | null;
	configured: boolean | null;
	onInstructionChange: (instruction: string) => void;
	onDraftChange: (sql: string) => void;
	onGenerate: (scope: SqlEditScope) => Promise<void>;
	onApplyDraft: (mode: AiDraftApplyMode) => void;
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
	const [selection, setSelection] = useState<SqlSelection>();
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

	const updateSelection = useCallback((state: EditorState) => {
		const { from, to } = state.selection.main;
		setSelection(
			from === to ? undefined : { from, to, text: state.sliceDoc(from, to) },
		);
	}, []);

	const editorActivityExtension = useMemo(
		() =>
			EditorView.updateListener.of((update) => {
				if (update.selectionSet || update.docChanged) {
					updateSelection(update.state);
				}
				if (update.selectionSet && onCursorActivity) {
					const pos = update.state.selection.main.head;
					const line = update.state.doc.lineAt(pos);
					onCursorActivity(line.number - 1, pos - line.from);
				}
			}),
		[onCursorActivity, updateSelection],
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
			editorActivityExtension,
		],
		[
			runQueryKeymap,
			sqlExtension,
			editorChromeTheme,
			disabled,
			editorActivityExtension,
		],
	);
	const draftExtensions = useMemo(
		() => [sqlExtension, editorChromeTheme, EditorView.lineWrapping],
		[sqlExtension, editorChromeTheme],
	);

	return (
		<div className="space-y-2">
			{ai && (
				<SqlAiPrompt
					value={value}
					instruction={instruction}
					selection={selection}
					tableCount={tables.length}
					configured={ai.configured}
					generating={generating}
					onInstructionChange={ai.onInstructionChange}
					onGenerate={ai.onGenerate}
				/>
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
				<SqlEditorToolbar
					value={value}
					toolbarActions={toolbarActions}
					onRunQuery={onRunQuery}
					onRunAllQueries={onRunAllQueries}
					cursorWarning={cursorWarning}
					disabled={disabled}
					reviewing={reviewing}
					executing={executing}
				/>
				{ai && aiDraft.status === "ready" && ai.review ? (
					<SqlAIPreview
						draft={aiDraft}
						review={ai.review}
						onDraftChange={ai.onDraftChange}
						embedded
						editorHeight="100%"
						editorExtensions={draftExtensions}
						editorTheme={isDark ? barf : ayuLight}
						onDiscard={ai.onDiscard}
						onApply={ai.onApplyDraft}
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
						onCreateEditor={(view) => updateSelection(view.state)}
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
