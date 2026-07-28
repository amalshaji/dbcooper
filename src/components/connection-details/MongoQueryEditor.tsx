import { json } from "@codemirror/lang-json";
import CodeMirror from "@uiw/react-codemirror";
import { useMemo } from "react";
import type { MongoQueryEditor as MongoQueryEditorState } from "@/lib/mongo/querySpec";

export function MongoQueryEditor({
	editor,
	onChange,
}: {
	editor: MongoQueryEditorState;
	onChange: (editor: MongoQueryEditorState) => void;
}) {
	const extensions = useMemo(() => [json()], []);
	if (editor.type === "aggregate") {
		return (
			<div className="border-b bg-card">
				<div className="px-3 py-1 text-xs text-muted-foreground">Pipeline</div>
				<CodeMirror
					value={editor.pipeline}
					height="120px"
					extensions={extensions}
					onChange={(pipeline) => onChange({ type: "aggregate", pipeline })}
				/>
			</div>
		);
	}

	return (
		<div className="grid grid-cols-3 border-b bg-card">
			{(
				[
					["filter", "Filter"],
					["projection", "Projection"],
					["sort", "Sort"],
				] as const
			).map(([field, label], index) => (
				<div key={field} className={index < 2 ? "border-r" : undefined}>
					<div className="px-3 py-1 text-xs text-muted-foreground">{label}</div>
					<CodeMirror
						value={editor[field]}
						height="120px"
						extensions={extensions}
						onChange={(value) => onChange({ ...editor, [field]: value })}
					/>
				</div>
			))}
		</div>
	);
}
