import {
	CaretDown,
	CaretRight,
	Database,
	Eye,
	EyeSlash,
	Lock,
	Plus,
	TerminalWindow,
} from "@phosphor-icons/react";
import { Button } from "@/components/ui/button";
import type { MongoWorkbenchController } from "@/hooks/connection-details/useMongoWorkbench";

export function MongoCatalogSidebar({
	workbench,
	onCreateCollection,
}: {
	workbench: MongoWorkbenchController;
	onCreateCollection: () => void;
}) {
	const visibleCatalog = workbench.catalog
		.map((database) => ({
			...database,
			collections: database.collections.filter(
				(collection) =>
					workbench.showSystemCollections || !collection.is_system,
			),
		}))
		.filter((database) => database.collections.length > 0);

	return (
		<aside className="w-60 shrink-0 overflow-auto border-r bg-sidebar/80 p-2">
			<div className="mb-1.5 flex h-8 items-center justify-between px-2 text-[11px] font-semibold uppercase tracking-[0.08em] text-muted-foreground">
				<span>Databases</span>
				<div className="flex items-center gap-0.5">
					<Button
						size="icon-xs"
						variant="ghost"
						onClick={() =>
							workbench.actions.setShowSystemCollections(
								!workbench.showSystemCollections,
							)
						}
						aria-label={
							workbench.showSystemCollections
								? "Hide system collections"
								: "Show system collections"
						}
					>
						{workbench.showSystemCollections ? <EyeSlash /> : <Eye />}
					</Button>
					<Button
						size="icon-xs"
						variant="ghost"
						onClick={onCreateCollection}
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
			{visibleCatalog.length === 0 && (
				<div className="mx-2 rounded-lg border border-dashed px-3 py-5 text-center text-xs text-muted-foreground">
					No databases found
				</div>
			)}
			{visibleCatalog.map((database) => (
				<div key={database.name}>
					<button
						className="flex h-8 w-full items-center gap-1.5 rounded-md px-2 text-left text-sm transition-colors hover:bg-accent/70"
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
								className={`h-8 w-full truncate rounded-md py-1 pl-8 pr-2 text-left text-sm transition-colors ${
									workbench.namespace.database === database.name &&
									workbench.namespace.collection === collection.name
										? "bg-emerald-500/10 font-medium text-emerald-800 ring-1 ring-inset ring-emerald-500/15 dark:text-emerald-200"
										: "hover:bg-accent/70"
								}`}
								onClick={() =>
									workbench.actions.selectCollection(
										database.name,
										collection.name,
									)
								}
							>
								<span className="flex min-w-0 items-center gap-1.5">
									<span className="truncate">{collection.name}</span>
									{collection.is_system && (
										<Lock
											className="size-3 shrink-0 text-muted-foreground"
											aria-label="Read-only system collection"
										/>
									)}
								</span>
							</button>
						))}
				</div>
			))}
			<div className="mt-4 border-t pt-3">
				<div className="px-2 text-[11px] font-semibold uppercase tracking-[0.08em] text-muted-foreground">
					Saved
				</div>
				{workbench.savedQueries.length === 0 && (
					<p className="px-2 py-2 text-xs text-muted-foreground/70">
						No saved queries
					</p>
				)}
				{workbench.savedQueries.map((query) => (
					<button
						key={query.id}
						className="flex h-8 w-full items-center gap-2 truncate rounded-md px-2 text-left text-xs hover:bg-accent/70"
						onClick={() => workbench.actions.loadQuery(query.query)}
					>
						<TerminalWindow className="size-3.5 shrink-0 text-muted-foreground" />
						<span className="truncate">{query.name}</span>
					</button>
				))}
			</div>
			<div className="mt-4 border-t pt-3">
				<div className="px-2 text-[11px] font-semibold uppercase tracking-[0.08em] text-muted-foreground">
					History
				</div>
				{workbench.history.length === 0 && (
					<p className="px-2 py-2 text-xs text-muted-foreground/70">
						No query history
					</p>
				)}
				{workbench.history.slice(0, 5).map((entry) => (
					<button
						key={entry.id}
						className="block h-8 w-full truncate rounded-md px-2 text-left text-xs text-muted-foreground hover:bg-accent/70 hover:text-foreground"
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
