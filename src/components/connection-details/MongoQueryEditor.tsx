import { Funnel, ListDashes, SortAscending } from "@phosphor-icons/react";
import { MongoJsonEditor } from "@/components/connection-details/MongoJsonEditor";
import type { MongoQueryEditor as MongoQueryEditorState } from "@/lib/mongo/querySpec";

export function MongoQueryEditor({
	editor,
	onChange,
}: {
	editor: MongoQueryEditorState;
	onChange: (editor: MongoQueryEditorState) => void;
}) {
	if (editor.type === "aggregate") {
		return (
			<section className="border-b bg-muted/20 p-3">
				<div className="mb-2 flex items-center gap-1.5 text-xs font-medium text-muted-foreground">
					<ListDashes className="size-3.5" />
					Aggregation pipeline
				</div>
				<MongoJsonEditor
					value={editor.pipeline}
					height="132px"
					ariaLabel="Aggregation pipeline"
					onChange={(pipeline) => onChange({ type: "aggregate", pipeline })}
				/>
			</section>
		);
	}

	const fields = [
		["filter", "Filter", Funnel],
		["projection", "Projection", ListDashes],
		["sort", "Sort", SortAscending],
	] as const;

	return (
		<section className="grid grid-cols-3 gap-2 border-b bg-muted/20 p-3">
			{fields.map(([field, label, Icon]) => (
				<div key={field} className="min-w-0">
					<div className="mb-2 flex items-center gap-1.5 text-xs font-medium text-muted-foreground">
						<Icon className="size-3.5" />
						{label}
					</div>
					<MongoJsonEditor
						value={editor[field]}
						height="132px"
						ariaLabel={`${label} JSON`}
						onChange={(value) => onChange({ ...editor, [field]: value })}
					/>
				</div>
			))}
		</section>
	);
}
