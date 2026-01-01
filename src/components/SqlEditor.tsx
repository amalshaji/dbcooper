import { useMemo, useEffect, useState, useRef } from "react";
import CodeMirror from "@uiw/react-codemirror";
import { sql } from "@codemirror/lang-sql";
import { rosePineDawn, barf } from "thememirror";
import { keymap } from "@codemirror/view";
import { EditorView } from "@codemirror/view";
import { Prec } from "@codemirror/state";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Sparkle, Warning, WarningCircle } from "@phosphor-icons/react";
import { Spinner } from "@/components/ui/spinner";
import {
	Tooltip,
	TooltipContent,
	TooltipTrigger,
} from "@/components/ui/tooltip";

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
	onGenerateSQL?: (instruction: string, existingSQL: string) => void;
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
						run: () => {
							if (onRunQuery && !disabled && value.trim()) {
								onRunQuery();
								return true;
							}
							return false;
						},
					},
				]),
			),
		[onRunQuery],
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

	const extensions = useMemo(
		() => [
			runQueryKeymap,
			sql(),
			fontTheme,
			EditorView.lineWrapping,
			cursorExtension,
		],
		[runQueryKeymap, fontTheme, cursorExtension],
	);

	const handleGenerate = () => {
		if (instruction.trim() && onGenerateSQL) {
			onGenerateSQL(instruction, value);
		}
	};

	const isButtonDisabled =
		!instruction.trim() || generating || aiConfigured === false;

	return (
		<div className="space-y-2">
			{onGenerateSQL && tables.length > 0 && (
				<div className="flex gap-2">
					<Input
						placeholder={
							aiConfigured === false
								? "Configure API in Settings to enable AI"
								: "Describe the SQL you want to generate"
						}
						value={instruction}
						onChange={(e) => setInstruction(e.target.value)}
						onKeyDown={(e) => {
							if (e.key === "Enter" && !generating && aiConfigured !== false) {
								handleGenerate();
							}
						}}
						disabled={generating || aiConfigured === false}
					/>
					<Tooltip>
						<TooltipTrigger
							render={
								<Button
									onClick={handleGenerate}
									disabled={isButtonDisabled}
									className="whitespace-nowrap"
								>
									{generating ? (
										<Spinner className="h-4 w-4" />
									) : (
										<Sparkle className="h-4 w-4" />
									)}
									Generate
								</Button>
							}
						/>
						{aiConfigured === false && (
							<TooltipContent>
								<p>
									Set API endpoint and key in Settings to enable AI generation
								</p>
							</TooltipContent>
						)}
					</Tooltip>
				</div>
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
