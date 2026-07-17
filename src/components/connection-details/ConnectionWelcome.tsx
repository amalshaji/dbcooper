import { Database, Graph, Plus } from "@phosphor-icons/react";
import { Button } from "@/components/ui/button";
import type { Connection } from "@/lib/tauri";

interface ConnectionWelcomeProps {
	connection: Connection;
	totalObjectCount: number;
	objectSchemaCount: number;
	onNewQuery: () => void;
	onOpenSchemaVisualizer: () => void;
}

export function ConnectionWelcome({
	connection,
	totalObjectCount,
	objectSchemaCount,
	onNewQuery,
	onOpenSchemaVisualizer,
}: ConnectionWelcomeProps) {
	const stats = [
		{ label: "objects", value: totalObjectCount },
		{ label: "schemas", value: objectSchemaCount },
	];

	return (
		<div className="flex h-full items-center justify-center p-4">
			<div className="workspace-panel w-full max-w-lg rounded-xl border px-8 py-9 text-center shadow-sm">
				<div className="mx-auto mb-5 flex size-12 items-center justify-center rounded-lg bg-primary/10 text-primary ring-1 ring-primary/15">
					<Database className="size-5" />
				</div>
				<h2 className="text-lg font-semibold tracking-tight">
					Welcome to {connection.name}
				</h2>
				<p className="mx-auto mt-1.5 max-w-sm text-sm text-muted-foreground">
					Open a table, view, or function from the sidebar — or start a new SQL
					query.
				</p>

				<div className="mt-5 flex items-center justify-center gap-2 text-xs text-muted-foreground tabular-figures">
					{stats.map((stat) => (
						<span
							key={stat.label}
							className="inline-flex items-center gap-1.5 rounded-md border bg-muted/40 px-2.5 py-1"
						>
							<span className="font-semibold text-foreground">
								{stat.value}
							</span>
							{stat.label}
						</span>
					))}
				</div>

				<div className="mt-6 flex items-center justify-center gap-2">
					<Button onClick={onNewQuery} size="sm">
						<Plus className="size-4" weight="bold" />
						New query
					</Button>
					{connection.db_type !== "clickhouse" && (
						<Button
							onClick={onOpenSchemaVisualizer}
							variant="outline"
							size="sm"
						>
							<Graph className="size-4" />
							Schema
						</Button>
					)}
				</div>
			</div>
		</div>
	);
}
