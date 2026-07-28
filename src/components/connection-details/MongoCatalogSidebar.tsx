import { CaretDown, CaretRight, Database, Plus } from "@phosphor-icons/react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import type { MongoWorkbenchController } from "@/hooks/connection-details/useMongoWorkbench";

export function MongoCatalogSidebar({
	workbench,
}: {
	workbench: MongoWorkbenchController;
}) {
	const createCollection = async () => {
		const namespace = window.prompt("New collection (database.collection)");
		if (!namespace) return;
		try {
			await workbench.actions.createCollection(namespace);
			toast.success("Collection created");
		} catch (error) {
			toast.error("Could not create collection", {
				description: String(error),
			});
		}
	};

	return (
		<aside className="w-60 shrink-0 overflow-auto border-r bg-sidebar p-2">
			<div className="mb-2 flex items-center justify-between px-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
				<span>Databases</span>
				<div className="flex">
					<Button
						size="icon-xs"
						variant="ghost"
						onClick={() => void createCollection()}
						aria-label="Create collection"
					>
						<Plus />
					</Button>
					<Button
						size="icon-xs"
						variant="ghost"
						onClick={() => void workbench.actions.refreshCatalog()}
						aria-label="Refresh catalog"
					>
						<Database />
					</Button>
				</div>
			</div>
			{workbench.catalog.map((database) => (
				<div key={database.name}>
					<button
						className="flex w-full items-center gap-1 rounded px-2 py-1 text-left text-sm hover:bg-accent"
						onClick={() => workbench.actions.toggleDatabase(database.name)}
					>
						{workbench.expanded.has(database.name) ? (
							<CaretDown />
						) : (
							<CaretRight />
						)}{" "}
						{database.name}
					</button>
					{workbench.expanded.has(database.name) &&
						database.collections.map((collection) => (
							<button
								key={collection.name}
								className={`w-full truncate rounded py-1 pl-7 pr-2 text-left text-sm ${
									workbench.namespace.database === database.name &&
									workbench.namespace.collection === collection.name
										? "bg-accent font-medium"
										: "hover:bg-accent"
								}`}
								onClick={() =>
									workbench.actions.selectCollection(
										database.name,
										collection.name,
									)
								}
							>
								{collection.name}
							</button>
						))}
				</div>
			))}
			<div className="mt-5 border-t pt-3">
				<div className="px-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
					Saved
				</div>
				{workbench.savedQueries.map((query) => (
					<button
						key={query.id}
						className="block w-full truncate rounded px-2 py-1 text-left text-sm hover:bg-accent"
						onClick={() => workbench.actions.loadQuery(query.query)}
					>
						{query.name}
					</button>
				))}
			</div>
			<div className="mt-4 border-t pt-3">
				<div className="px-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
					History
				</div>
				{workbench.history.slice(0, 5).map((entry) => (
					<button
						key={entry.id}
						className="block w-full truncate rounded px-2 py-1 text-left text-xs text-muted-foreground hover:bg-accent"
						onClick={() => workbench.actions.loadQuery(entry.query)}
					>
						{entry.query_kind.replace("mongo_", "")} · {entry.row_count ?? 0}{" "}
						docs
					</button>
				))}
			</div>
		</aside>
	);
}
