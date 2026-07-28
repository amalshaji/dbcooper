import { json } from "@codemirror/lang-json";
import { EditorView } from "@codemirror/view";
import CodeMirror from "@uiw/react-codemirror";
import { useEffect, useMemo, useState } from "react";
import { barf, rosePineDawn } from "thememirror";
import { cn } from "@/lib/utils";

interface MongoJsonEditorProps {
	value: string;
	onChange: (value: string) => void;
	height?: string;
	editable?: boolean;
	ariaLabel: string;
	className?: string;
}

export function MongoJsonEditor({
	value,
	onChange,
	height = "100%",
	editable = true,
	ariaLabel,
	className,
}: MongoJsonEditorProps) {
	const [isDark, setIsDark] = useState(false);

	useEffect(() => {
		const update = () =>
			setIsDark(document.documentElement.classList.contains("dark"));
		update();
		const observer = new MutationObserver(update);
		observer.observe(document.documentElement, {
			attributes: true,
			attributeFilter: ["class"],
		});
		return () => observer.disconnect();
	}, []);

	const extensions = useMemo(
		() => [
			json(),
			EditorView.lineWrapping,
			EditorView.theme({
				"&": { fontSize: "12px" },
				"&.cm-focused": { outline: "none" },
				".cm-scroller, .cm-content": {
					fontFamily: "'Google Sans Code Variable', monospace",
				},
				".cm-scroller": { overflowY: "auto" },
				".cm-content": { padding: "8px 0" },
				".cm-line": { padding: "0 10px" },
				".cm-gutters": { border: "none", backgroundColor: "transparent" },
			}),
		],
		[],
	);

	return (
		<div
			className={cn(
				"min-w-0 overflow-hidden rounded-lg border bg-card shadow-sm focus-within:border-ring focus-within:ring-1 focus-within:ring-ring/25",
				className,
			)}
		>
			<CodeMirror
				className={height === "100%" ? "h-full min-h-0" : undefined}
				value={value}
				height={height}
				width="100%"
				extensions={extensions}
				theme={isDark ? barf : rosePineDawn}
				onChange={onChange}
				editable={editable}
				aria-label={ariaLabel}
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
	);
}
