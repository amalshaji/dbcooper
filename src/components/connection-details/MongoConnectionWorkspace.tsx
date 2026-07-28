import { FloppyDisk, Play, Trash } from "@phosphor-icons/react";
import { useState } from "react";
import { toast } from "sonner";
import { ConnectionWorkspaceHeader } from "@/components/connection-details/ConnectionHeaders";
import { MongoCatalogSidebar } from "@/components/connection-details/MongoCatalogSidebar";
import { MongoCollectionAdmin } from "@/components/connection-details/MongoCollectionAdmin";
import { MongoDocumentBrowser } from "@/components/connection-details/MongoDocumentBrowser";
import { MongoQueryEditor } from "@/components/connection-details/MongoQueryEditor";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Spinner } from "@/components/ui/spinner";
import type { ConnectionLifecycleController } from "@/hooks/connection-details/useConnectionLifecycle";
import { useMongoWorkbench } from "@/hooks/connection-details/useMongoWorkbench";
import type { MongoConnection } from "@/types/connection";

type CollectionView = "documents" | "indexes" | "validation";

interface MongoConnectionWorkspaceProps {
	connection: MongoConnection;
	lifecycle: ConnectionLifecycleController;
	onClose: () => void;
	onOpenSettings: () => void;
}

export function MongoConnectionWorkspace({
	connection,
	lifecycle,
	onClose,
	onOpenSettings,
}: MongoConnectionWorkspaceProps) {
	const workbench = useMongoWorkbench(connection.uuid);
	const [collectionView, setCollectionView] =
		useState<CollectionView>("documents");

	const dropCollection = async () => {
		const namespace = `${workbench.namespace.database}.${workbench.namespace.collection}`;
		if (window.prompt(`Type ${namespace} to drop this collection`) !== namespace) {
			return;
		}
		try {
			await workbench.actions.dropCollection();
			toast.success("Collection dropped");
		} catch (error) {
			toast.error("Could not drop collection", { description: String(error) });
		}
	};

	return (
		<div className="workspace-canvas flex h-screen flex-col">
			<ConnectionWorkspaceHeader
				connection={connection}
				onClose={onClose}
				connectionStatus={lifecycle.connection.status}
				onReconnect={lifecycle.commands.reconnect}
				onStatusChange={lifecycle.commands.recordConnectionStatus}
				onOpenSettings={onOpenSettings}
			/>
			<div className="flex min-h-0 flex-1">
				<MongoCatalogSidebar workbench={workbench} />
				<main className="flex min-w-0 flex-1 flex-col">
					<div className="flex items-center gap-2 border-b p-2">
						{(["documents", "indexes", "validation"] as const).map((view) => (
							<Button
								key={view}
								size="sm"
								variant={collectionView === view ? "secondary" : "ghost"}
								onClick={() => setCollectionView(view)}
							>
								{view[0].toUpperCase() + view.slice(1)}
							</Button>
						))}
						{collectionView === "documents" && (
							<>
								<span className="mx-1 h-5 border-l" />
								{(["find", "aggregate"] as const).map((mode) => (
									<Button
										key={mode}
										size="sm"
										variant={
											workbench.editor.type === mode ? "secondary" : "ghost"
										}
										onClick={() => workbench.actions.setMode(mode)}
									>
										{mode[0].toUpperCase() + mode.slice(1)}
									</Button>
								))}
							</>
						)}
						<span className="ml-2 truncate text-sm text-muted-foreground">
							{workbench.namespace.database && workbench.namespace.collection
								? `${workbench.namespace.database}.${workbench.namespace.collection}`
								: "Select a collection"}
						</span>
						{workbench.namespace.collection && (
							<Button
								size="icon-sm"
								variant="ghost"
								aria-label="Drop collection"
								onClick={() => void dropCollection()}
							>
								<Trash />
							</Button>
						)}
						{collectionView === "documents" && (
							<div className="ml-auto flex items-center gap-2">
								<Input
									className="h-8 w-40"
									value={workbench.queryName}
									onChange={(event) =>
										workbench.actions.setQueryName(event.target.value)
									}
									placeholder="Saved query name"
								/>
								<Button
									size="sm"
									variant="outline"
									onClick={() => void workbench.actions.saveQuery()}
								>
									<FloppyDisk />
									Save
								</Button>
								<Button
									size="sm"
									onClick={() => void workbench.actions.run()}
									disabled={workbench.loading || !workbench.namespace.collection}
								>
									{workbench.loading && <Spinner />}
									<Play />
									Run
								</Button>
							</div>
						)}
					</div>
					{collectionView === "documents" ? (
						<>
							<MongoQueryEditor
								editor={workbench.editor}
								onChange={workbench.actions.setEditor}
							/>
							<MongoDocumentBrowser workbench={workbench} />
						</>
					) : (
						<MongoCollectionAdmin
							uuid={connection.uuid}
							database={workbench.namespace.database}
							collection={workbench.namespace.collection}
							view={collectionView}
						/>
					)}
				</main>
			</div>
		</div>
	);
}
