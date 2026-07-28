import { BracketsCurly, FloppyDisk, Play, Trash } from "@phosphor-icons/react";
import { type FormEvent, useState } from "react";
import { toast } from "sonner";
import { MongoAiAssistant } from "@/components/connection-details/MongoAiAssistant";
import { ConnectionWorkspaceHeader } from "@/components/connection-details/ConnectionHeaders";
import { MongoCatalogSidebar } from "@/components/connection-details/MongoCatalogSidebar";
import { MongoCollectionAdmin } from "@/components/connection-details/MongoCollectionAdmin";
import { MongoDocumentBrowser } from "@/components/connection-details/MongoDocumentBrowser";
import { MongoQueryEditor } from "@/components/connection-details/MongoQueryEditor";
import {
	AlertDialog,
	AlertDialogAction,
	AlertDialogCancel,
	AlertDialogContent,
	AlertDialogDescription,
	AlertDialogFooter,
	AlertDialogHeader,
	AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import {
	Dialog,
	DialogContent,
	DialogDescription,
	DialogFooter,
	DialogHeader,
	DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Spinner } from "@/components/ui/spinner";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import type { ConnectionLifecycleController } from "@/hooks/connection-details/useConnectionLifecycle";
import { useMongoAiGeneration } from "@/hooks/connection-details/useMongoAiGeneration";
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
	const [createDialogOpen, setCreateDialogOpen] = useState(false);
	const [newNamespace, setNewNamespace] = useState("");
	const [dropDialogOpen, setDropDialogOpen] = useState(false);
	const [collectionBusy, setCollectionBusy] = useState(false);
	const ai = useMongoAiGeneration(connection.uuid, workbench);
	const namespace = `${workbench.namespace.database}.${workbench.namespace.collection}`;

	const dropCollection = async () => {
		setCollectionBusy(true);
		try {
			await workbench.actions.dropCollection();
			setDropDialogOpen(false);
			toast.success("Collection dropped");
		} catch (error) {
			toast.error("Could not drop collection", { description: String(error) });
		} finally {
			setCollectionBusy(false);
		}
	};

	const createCollection = async (event: FormEvent) => {
		event.preventDefault();
		setCollectionBusy(true);
		try {
			await workbench.actions.createCollection(newNamespace.trim());
			setNewNamespace("");
			setCreateDialogOpen(false);
			toast.success("Collection created");
		} catch (error) {
			toast.error("Could not create collection", {
				description: String(error),
			});
		} finally {
			setCollectionBusy(false);
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
				<MongoCatalogSidebar
					workbench={workbench}
					onCreateCollection={() => setCreateDialogOpen(true)}
				/>
				<main className="flex min-w-0 flex-1 flex-col">
					<div className="flex min-h-12 items-center gap-2 border-b bg-card/45 px-3 py-2">
						<Tabs
							value={collectionView}
							onValueChange={(value) =>
								setCollectionView(value as CollectionView)
							}
						>
							<TabsList>
								{(["documents", "indexes", "validation"] as const).map(
									(view) => (
										<TabsTrigger key={view} value={view}>
											{view[0].toUpperCase() + view.slice(1)}
										</TabsTrigger>
									),
								)}
							</TabsList>
						</Tabs>
						{collectionView === "documents" && (
							<>
								<span className="mx-0.5 h-5 border-l" />
								<Tabs
									value={workbench.editor.type}
									onValueChange={(value) =>
										workbench.actions.setMode(value as "find" | "aggregate")
									}
								>
									<TabsList variant="line">
										<TabsTrigger value="find">Find</TabsTrigger>
										<TabsTrigger value="aggregate">Aggregate</TabsTrigger>
									</TabsList>
								</Tabs>
							</>
						)}
						<span className="ml-1 flex min-w-0 items-center gap-1.5 truncate text-xs text-muted-foreground">
							<BracketsCurly className="size-3.5 shrink-0" />
							{workbench.namespace.database && workbench.namespace.collection
								? namespace
								: "Select a collection"}
						</span>
						{workbench.namespace.collection && (
							<Button
								size="icon-sm"
								variant="ghost"
								aria-label="Drop collection"
								onClick={() => setDropDialogOpen(true)}
							>
								<Trash />
							</Button>
						)}
						{collectionView === "documents" && (
							<div className="ml-auto flex items-center gap-1.5">
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
									disabled={
										workbench.loading || !workbench.namespace.collection
									}
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
							<MongoAiAssistant
								state={ai.state}
								configured={ai.configured}
								available={Boolean(workbench.namespace.collection)}
								context={
									workbench.namespace.collection
										? `Using ${namespace}`
										: "Select a collection first"
								}
								onInstructionChange={ai.setInstruction}
								onGenerate={() => void ai.generate()}
								onUse={ai.useDraft}
								onDiscard={ai.discard}
							/>
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

			<Dialog open={createDialogOpen} onOpenChange={setCreateDialogOpen}>
				<DialogContent className="max-w-sm">
					<form onSubmit={(event) => void createCollection(event)}>
						<DialogHeader>
							<DialogTitle>Create collection</DialogTitle>
							<DialogDescription>
								{workbench.namespace.database
									? `Create a collection in ${workbench.namespace.database}.`
									: "Enter the database and collection as one namespace."}
							</DialogDescription>
						</DialogHeader>
						<div className="my-4 space-y-2">
							<label
								htmlFor="mongo-new-namespace"
								className="text-xs font-medium"
							>
								{workbench.namespace.database ? "Collection name" : "Namespace"}
							</label>
							<Input
								id="mongo-new-namespace"
								autoFocus
								value={newNamespace}
								onChange={(event) => setNewNamespace(event.target.value)}
								placeholder={
									workbench.namespace.database ? "users" : "database.collection"
								}
							/>
						</div>
						<DialogFooter>
							<Button
								type="button"
								variant="outline"
								onClick={() => setCreateDialogOpen(false)}
							>
								Cancel
							</Button>
							<Button
								type="submit"
								disabled={collectionBusy || !newNamespace.trim()}
							>
								{collectionBusy && <Spinner />} Create collection
							</Button>
						</DialogFooter>
					</form>
				</DialogContent>
			</Dialog>

			<AlertDialog open={dropDialogOpen} onOpenChange={setDropDialogOpen}>
				<AlertDialogContent>
					<AlertDialogHeader>
						<AlertDialogTitle>Drop {namespace}?</AlertDialogTitle>
						<AlertDialogDescription>
							Every document and index in this collection will be permanently
							deleted.
						</AlertDialogDescription>
					</AlertDialogHeader>
					<AlertDialogFooter>
						<AlertDialogCancel>Cancel</AlertDialogCancel>
						<AlertDialogAction
							variant="destructive"
							disabled={collectionBusy}
							onClick={() => void dropCollection()}
						>
							{collectionBusy && <Spinner />} Drop collection
						</AlertDialogAction>
					</AlertDialogFooter>
				</AlertDialogContent>
			</AlertDialog>
		</div>
	);
}
