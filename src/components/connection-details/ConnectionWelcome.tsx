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
			<div className="w-full max-w-md text-center">
				<div className="mx-auto mb-5 flex size-14 items-center justify-center rounded-2xl bg-gradient-to-b from-primary/15 to-primary/5 text-primary ring-1 ring-primary/20 shadow-sm">
					<Database className="size-7" />
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
							className="inline-flex items-center gap-1.5 rounded-full bg-muted px-2.5 py-1 ring-1 ring-border"
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
						New Query
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
