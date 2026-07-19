interface CreateTableReviewProps {
	sql: string;
}

export function CreateTableReview({ sql }: CreateTableReviewProps) {
	return (
		<div className="space-y-3">
			<div>
				<h3 className="text-sm font-medium">Generated SQL</h3>
				<p className="text-xs text-muted-foreground">
					This statement is regenerated from the definition when created.
				</p>
			</div>
			<pre
				aria-label="Generated SQL"
				className="overflow-x-auto rounded-lg border bg-muted/40 p-4 font-mono text-xs leading-relaxed select-text"
			>
				{sql}
			</pre>
		</div>
	);
}
