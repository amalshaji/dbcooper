import {
	Database,
	Cube,
	Gear,
	GithubLogo,
	Plus,
	UploadSimple,
} from "@phosphor-icons/react";
import { open, save } from "@tauri-apps/plugin-dialog";
import { readTextFile, writeTextFile } from "@tauri-apps/plugin-fs";
import { revealItemInDir } from "@tauri-apps/plugin-opener";
import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { toast } from "sonner";
import { ConnectionForm } from "@/components/ConnectionForm";
import { ConnectionCard } from "@/components/connections/ConnectionCard";
import { DeleteConnectionDialog } from "@/components/connections/DeleteConnectionDialog";
import { ConnectDockerDialog } from "@/components/docker/ConnectDockerDialog";
import { CreateDatabaseDialog } from "@/components/docker/CreateDatabaseDialog";
import { EmptyState } from "@/components/EmptyState";
import { UpdateChecker } from "@/components/UpdateChecker";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Spinner } from "@/components/ui/spinner";
import {
	api,
	type Connection,
	type ConnectionFormData,
	type ConnectionsExport,
	type DockerConnectionState,
} from "@/lib/tauri";

export function Connections() {
	const navigate = useNavigate();
	const [connections, setConnections] = useState<Connection[]>([]);
	const [loading, setLoading] = useState(true);
	const [isFormOpen, setIsFormOpen] = useState(false);
	const [editingConnection, setEditingConnection] = useState<Connection | null>(
		null,
	);
	const [deletingConnection, setDeletingConnection] =
		useState<Connection | null>(null);
	const [isDeleting, setIsDeleting] = useState(false);
	const [createDatabaseOpen, setCreateDatabaseOpen] = useState(false);
	const [connectDockerOpen, setConnectDockerOpen] = useState(false);
	const [deleteDockerData, setDeleteDockerData] = useState(false);
	const [dockerStates, setDockerStates] = useState<
		Record<string, DockerConnectionState>
	>({});

	const fetchConnections = async () => {
		try {
			const [data, states] = await Promise.all([
				api.connections.list(),
				api.docker.states(),
			]);
			setConnections(data);
			setDockerStates(
				Object.fromEntries(
					states.map((state) => [state.connection_uuid, state]),
				),
			);
		} catch (error) {
			console.error("Failed to fetch connections:", error);
		} finally {
			setLoading(false);
		}
	};

	useEffect(() => {
		fetchConnections();
	}, []);

	const handleCreateConnection = async (data: ConnectionFormData) => {
		try {
			await api.connections.create(data);
			await fetchConnections();
			setIsFormOpen(false);
		} catch (error) {
			console.error("Failed to create connection:", error);
		}
	};

	const handleUpdateConnection = async (data: ConnectionFormData) => {
		if (!editingConnection) return;
		try {
			await api.connections.update(editingConnection.id, data);
			await fetchConnections();
			setEditingConnection(null);
			setIsFormOpen(false);
		} catch (error) {
			console.error("Failed to update connection:", error);
		}
	};

	const handleEditConnection = (connection: Connection) => {
		setEditingConnection(connection);
		setIsFormOpen(true);
	};

	const handleCloseForm = () => {
		setEditingConnection(null);
		setIsFormOpen(false);
	};

	const handleDeleteClick = (connection: Connection) => {
		setDeleteDockerData(false);
		setDeletingConnection(connection);
	};

	const handleConfirmDelete = async () => {
		if (!deletingConnection) return;

		setIsDeleting(true);
		try {
			const result = await api.connections.delete(
				deletingConnection.id,
				deleteDockerData,
			);
			await fetchConnections();
			setDeletingConnection(null);
			if (result.docker_cleanup_warning) {
				toast.warning(
					`Connection deleted, but Docker cleanup failed: ${result.docker_cleanup_warning}`,
				);
			}
		} catch (error) {
			console.error("Failed to delete connection:", error);
			toast.error(String(error));
		} finally {
			setIsDeleting(false);
		}
	};

	const handleCancelDelete = () => {
		setDeleteDockerData(false);
		setDeletingConnection(null);
	};

	const handleCopyConnectionString = async (connection: Connection) => {
		try {
			const value = await api.docker.connectionString(connection.uuid);
			await navigator.clipboard.writeText(value);
			toast.success("Connection string copied");
		} catch (error) {
			toast.error(String(error));
		}
	};

	const handleDockerAction = async (
		connection: Connection,
		action: "start" | "stop" | "restart",
	) => {
		try {
			await api.docker.control(connection.uuid, action);
			await fetchConnections();
			const labels = {
				start: "Started",
				stop: "Stopped",
				restart: "Restarted",
			};
			toast.success(`${labels[action]} container`);
		} catch (error) {
			toast.error(String(error));
		}
	};

	const handleDuplicateConnection = async (connection: Connection) => {
		try {
			const duplicatedData: ConnectionFormData = {
				type: connection.type,
				name: `${connection.name} (Copy)`,
				host: connection.host,
				port: connection.port,
				database: connection.database,
				username: connection.username,
				password: connection.password,
				ssl: Boolean(connection.ssl),
				db_type: connection.db_type,
				file_path: connection.file_path ?? undefined,
				ssh_enabled: connection.ssh_enabled
					? Boolean(connection.ssh_enabled)
					: undefined,
				ssh_host: connection.ssh_host,
				ssh_port: connection.ssh_port,
				ssh_user: connection.ssh_user,
				ssh_password: connection.ssh_password,
				ssh_key_path: connection.ssh_key_path,
				ssh_use_key: connection.ssh_use_key
					? Boolean(connection.ssh_use_key)
					: undefined,
			};

			await api.connections.create(duplicatedData);
			await fetchConnections();
		} catch (error) {
			console.error("Failed to duplicate connection:", error);
		}
	};

	const handleExportConnection = async (connection: Connection) => {
		try {
			const exportData = await api.connections.exportOne(connection.id);
			const safeName = connection.name
				.replace(/[^a-z0-9]/gi, "_")
				.toLowerCase();
			const filePath = await save({
				defaultPath: `${safeName}.dbcooper`,
				filters: [
					{
						name: "DBcooper Export",
						extensions: ["dbcooper", "json"],
					},
				],
			});

			if (filePath) {
				await writeTextFile(filePath, JSON.stringify(exportData, null, 2));
				toast.success(`Exported "${connection.name}"`, {
					action: {
						label: "Open File Location",
						onClick: () => revealItemInDir(filePath),
					},
				});
			}
		} catch (error) {
			console.error("Failed to export connection:", error);
			toast.error("Failed to export connection");
		}
	};

	const handleImportConnections = async () => {
		try {
			const filePath = await open({
				multiple: false,
				filters: [
					{
						name: "DBcooper Export",
						extensions: ["dbcooper", "json"],
					},
				],
			});

			if (filePath && typeof filePath === "string") {
				const content = await readTextFile(filePath);
				const importData: ConnectionsExport = JSON.parse(content);
				const importedCount =
					await api.connections.importConnections(importData);
				await fetchConnections();
				toast.success(
					`Imported ${importedCount} connection${importedCount !== 1 ? "s" : ""}`,
				);
			}
		} catch (error) {
			console.error("Failed to import connections:", error);
			const errorMessage =
				error instanceof Error ? error.message : String(error);
			toast.error(`Failed to import: ${errorMessage}`);
		}
	};

	if (loading) {
		return (
			<div className="workspace-canvas flex min-h-screen items-center justify-center">
				<div className="workspace-panel flex min-w-56 items-center rounded-lg border px-4 py-3 shadow-sm">
					<Spinner className="size-4" />
					<p className="ml-3 text-sm text-muted-foreground">
						Loading connections…
					</p>
				</div>
			</div>
		);
	}

	return (
		<div className="workspace-canvas flex min-h-screen flex-col">
			<header
				data-tauri-drag-region
				className="app-titlebar flex h-12 shrink-0 select-none items-center justify-between border-b px-4 pl-20"
			>
				<div className="flex items-center gap-2 pl-4">
					<h1 className="text-sm font-semibold text-foreground">Connections</h1>
					<Badge variant="secondary" className="h-5 px-1.5 text-[10px]">
						{connections.length}
					</Badge>
				</div>
				<div className="flex items-center gap-1">
					<UpdateChecker />
					<a
						href="https://github.com/amalshaji/dbcooper"
						target="_blank"
						rel="noopener noreferrer"
						className="inline-flex size-8 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-muted hover:text-foreground active:scale-95"
						title="View on GitHub"
						aria-label="View DBcooper on GitHub"
					>
						<GithubLogo className="size-4" />
					</a>

					<button
						type="button"
						onClick={() => navigate("/settings")}
						className="inline-flex size-8 cursor-pointer items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-muted hover:text-foreground active:scale-95"
						title="Settings"
						aria-label="Open settings"
					>
						<Gear className="size-4" />
					</button>
				</div>
			</header>

			<main className="flex-1 overflow-auto p-5 md:p-8">
				<div className="mx-auto max-w-5xl">
					{connections.length === 0 ? (
						<div className="flex min-h-[calc(100vh-8rem)] items-center justify-center">
							<EmptyState
								icon={<Database />}
								title="No connections yet"
								description="Create a local workspace for PostgreSQL, SQLite, Redis, or ClickHouse. Credentials stay on this Mac."
								actions={[
									{
										label: "Create database",
										onClick: () => setCreateDatabaseOpen(true),
									},
									{
										label: "Connect Docker",
										onClick: () => setConnectDockerOpen(true),
										variant: "outline",
									},
									{
										label: "New connection",
										onClick: () => setIsFormOpen(true),
										variant: "outline",
									},
								]}
							/>
						</div>
					) : (
						<div className="space-y-5 pt-2">
							<div className="flex items-center justify-between">
								<div>
									<p className="section-label">Workspace</p>
									<h2 className="mt-1 text-xl font-semibold tracking-tight">
										Your databases
									</h2>
									<p className="mt-1 text-xs text-muted-foreground">
										Open a connection to browse data or write a query.
									</p>
								</div>
								<div className="flex items-center gap-2">
									<Button
										onClick={() => setConnectDockerOpen(true)}
										size="sm"
										variant="outline"
									>
										<Cube className="size-4" />
										Connect Docker
									</Button>
									<Button onClick={() => setCreateDatabaseOpen(true)} size="sm">
										<Plus className="size-4" weight="bold" />
										Create database
									</Button>
									<Button
										onClick={handleImportConnections}
										size="sm"
										variant="outline"
									>
										<UploadSimple className="size-4" />
										Import
									</Button>
									<Button
										onClick={() => setIsFormOpen(true)}
										size="sm"
										variant="outline"
									>
										<Plus className="size-4" weight="bold" />
										New connection
									</Button>
								</div>
							</div>

							<div className="grid grid-cols-1 gap-2.5 lg:grid-cols-2">
								{connections.map((connection) => (
									<ConnectionCard
										key={connection.id}
										connection={connection}
										dockerState={dockerStates[connection.uuid]}
										onOpen={() => navigate(`/connections/${connection.uuid}`)}
										onCopyConnectionString={() =>
											handleCopyConnectionString(connection)
										}
										onDockerAction={(action) =>
											handleDockerAction(connection, action)
										}
										onEdit={() => handleEditConnection(connection)}
										onDuplicate={() => handleDuplicateConnection(connection)}
										onExport={() => handleExportConnection(connection)}
										onDelete={() => handleDeleteClick(connection)}
									/>
								))}
							</div>
						</div>
					)}
				</div>

				<ConnectionForm
					isOpen={isFormOpen}
					onSubmit={
						editingConnection ? handleUpdateConnection : handleCreateConnection
					}
					onCancel={handleCloseForm}
					initialData={editingConnection}
				/>
				<CreateDatabaseDialog
					open={createDatabaseOpen}
					onOpenChange={setCreateDatabaseOpen}
					onCreated={async () => fetchConnections()}
				/>
				<ConnectDockerDialog
					open={connectDockerOpen}
					onOpenChange={setConnectDockerOpen}
					onLinked={async () => fetchConnections()}
				/>

				<DeleteConnectionDialog
					connection={deletingConnection}
					dockerState={
						deletingConnection
							? dockerStates[deletingConnection.uuid]
							: undefined
					}
					deleteDockerData={deleteDockerData}
					deleting={isDeleting}
					onDeleteDockerDataChange={setDeleteDockerData}
					onCancel={handleCancelDelete}
					onConfirm={handleConfirmDelete}
				/>
			</main>
		</div>
	);
}
