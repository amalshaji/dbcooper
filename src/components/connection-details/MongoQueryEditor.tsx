import { Funnel, ListDashes, Play, SortAscending } from "@phosphor-icons/react";
import { MongoJsonEditor } from "@/components/connection-details/MongoJsonEditor";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Spinner } from "@/components/ui/spinner";
import type { MongoQueryEditor as MongoQueryEditorState } from "@/lib/mongo/querySpec";

export function MongoQueryEditor({
	editor,
	onChange,
	onRun,
	loading,
	disabled,
}: {
	editor: MongoQueryEditorState;
	onChange: (editor: MongoQueryEditorState) => void;
	onRun: () => void;
	loading: boolean;
	disabled: boolean;
}) {
	const runAction = (
		<div className="mt-2 flex items-center justify-end gap-2">
			<label className="flex items-center gap-2 text-xs text-muted-foreground">
				Limit
				<Input
					type="number"
					min={1}
					max={1000}
					className="h-8 w-20"
					value={editor.limit}
					onChange={(event) =>
						onChange({ ...editor, limit: Number(event.target.value) })
					}
					aria-label="Query result limit"
				/>
			</label>
			<Button size="sm" onClick={onRun} disabled={disabled || loading}>
				{loading ? <Spinner /> : <Play />}
				Run query
			</Button>
		</div>
	);

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
					onChange={(pipeline) => onChange({ ...editor, pipeline })}
				/>
				{runAction}
			</section>
		);
	}

	const fields = [
		["filter", "Filter", Funnel],
		["projection", "Projection", ListDashes],
		["sort", "Sort", SortAscending],
	] as const;

	return (
		<section className="border-b bg-muted/20 p-3">
			<div className="grid grid-cols-3 gap-2">
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
			</div>
			{runAction}
		</section>
	);
}
