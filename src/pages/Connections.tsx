import {
	Copy,
	Database,
	Cube,
	DotsThreeVertical,
	Export,
	Gear,
	GithubLogo,
	Lock,
	PencilSimple,
	Plus,
	ArrowClockwise,
	Play,
	Stop,
	Trash,
	UploadSimple,
} from "@phosphor-icons/react";
import { open, save } from "@tauri-apps/plugin-dialog";
import { readTextFile, writeTextFile } from "@tauri-apps/plugin-fs";
import { revealItemInDir } from "@tauri-apps/plugin-opener";
import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { toast } from "sonner";
import { ConnectionForm } from "@/components/ConnectionForm";
import { ConnectDockerDialog } from "@/components/docker/ConnectDockerDialog";
import { CreateDatabaseDialog } from "@/components/docker/CreateDatabaseDialog";
import { EmptyState } from "@/components/EmptyState";
import { ClickhouseIcon } from "@/components/icons/clickhouse";

import { PostgresqlIcon } from "@/components/icons/postgres";
import { RedisIcon } from "@/components/icons/redis";
import { SqliteIcon } from "@/components/icons/sqlite";
import { UpdateChecker } from "@/components/UpdateChecker";
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
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import {
	ContextMenu,
	ContextMenuContent,
	ContextMenuItem,
	ContextMenuTrigger,
} from "@/components/ui/context-menu";
import {
	DropdownMenu,
	DropdownMenuContent,
	DropdownMenuItem,
	DropdownMenuSeparator,
	DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Spinner } from "@/components/ui/spinner";
import {
	api,
	type Connection,
	type ConnectionFormData,
	type ConnectionsExport,
	type DockerConnectionState,
} from "@/lib/tauri";

const getDbTypeConfig = (type: string) => {
	switch (type) {
		case "postgres":
			return {
				icon: PostgresqlIcon,
				iconClass: "bg-blue-500/10 text-blue-600 dark:text-blue-400",
				accentClass: "bg-blue-500",
			};
		case "mysql":
			return {
				icon: Database,
				iconClass: "bg-orange-500/10 text-orange-600 dark:text-orange-400",
				accentClass: "bg-orange-500",
			};
		case "sqlite":
			return {
				icon: SqliteIcon,
				iconClass: "bg-cyan-500/10 text-cyan-700 dark:text-cyan-400",
				accentClass: "bg-cyan-500",
			};
		case "redis":
			return {
				icon: RedisIcon,
				iconClass: "bg-red-500/10 text-red-600 dark:text-red-400",
				accentClass: "bg-red-500",
			};
		case "clickhouse":
			return {
				icon: ClickhouseIcon,
				iconClass: "bg-yellow-500/10 text-yellow-700 dark:text-yellow-400",
				accentClass: "bg-yellow-500",
			};
		default:
			return {
				icon: Database,
				iconClass: "bg-primary/10 text-primary",
				accentClass: "bg-primary",
			};
	}
};

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
				api.docker.states().catch(() => []),
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
			await api.connections.delete(deletingConnection.id, deleteDockerData);
			await fetchConnections();
			setDeletingConnection(null);
		} catch (error) {
			console.error("Failed to delete connection:", error);
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
								{connections.map((connection) => {
									const dbConfig = getDbTypeConfig(
										connection.type || "postgres",
									);
									const DbIcon = dbConfig.icon;
									const dockerState = dockerStates[connection.uuid];

									return (
										<ContextMenu key={connection.id}>
											<ContextMenuTrigger>
												<div className="group workspace-panel relative overflow-hidden rounded-lg border p-3.5 shadow-sm transition-[border-color,box-shadow,transform] duration-150 hover:-translate-y-px hover:border-foreground/20 hover:shadow-md focus-within:ring-2 focus-within:ring-ring/40">
													<button
														type="button"
														onClick={() =>
															navigate(`/connections/${connection.uuid}`)
														}
														onMouseDown={(e) => {
															if (e.button === 1) {
																e.preventDefault();
																navigate(`/connections/${connection.uuid}`);
															}
														}}
														aria-label={`Open ${connection.name}`}
														className="absolute inset-0 cursor-pointer rounded-lg outline-none"
													/>
													<div
														className={`absolute inset-y-3 left-0 w-0.5 rounded-r-full opacity-70 ${dbConfig.accentClass}`}
													/>

													<div className="pointer-events-none relative flex items-center gap-3 pl-1">
														<div
															className={`flex size-9 shrink-0 items-center justify-center rounded-md ${dbConfig.iconClass}`}
														>
															<DbIcon className="size-4" />
														</div>

														<div className="min-w-0 flex-1">
															<div className="flex items-center gap-2">
																<h3 className="truncate text-sm font-medium">
																	{connection.name}
																</h3>
																{connection.ssl === 1 && (
																	<Lock
																		className="size-3 shrink-0 text-muted-foreground"
																		weight="fill"
																	/>
																)}
																{dockerState && (
																	<Badge
																		variant="outline"
																		className="h-5 shrink-0 px-1.5 py-0 text-[10px]"
																	>
																		{dockerState.ownership === "created"
																			? "Created by DBcooper"
																			: "Linked Docker"}{" "}
																		• {dockerState.status}
																	</Badge>
																)}
															</div>
															<p className="mt-0.5 truncate text-xs text-muted-foreground">
																{connection.type === "sqlite"
																	? connection.file_path?.split("/").pop() ||
																		"Local file"
																	: `${connection.host}:${connection.port}${connection.database ? ` • ${connection.database}` : ""}`}
															</p>
														</div>

														<DropdownMenu>
															<DropdownMenuTrigger
																onClick={(e) => e.stopPropagation()}
																className="pointer-events-auto shrink-0 cursor-pointer rounded-md p-1.5 text-muted-foreground opacity-0 transition-colors hover:bg-muted hover:text-foreground group-hover:opacity-100 group-focus-within:opacity-100"
																aria-label={`Actions for ${connection.name}`}
															>
																<DotsThreeVertical
																	className="size-4"
																	weight="bold"
																/>
															</DropdownMenuTrigger>
															<DropdownMenuContent
																align="end"
																side="bottom"
																className="w-56 p-1.5 [&_[role=menuitem]]:cursor-pointer [&_[role=menuitem]]:whitespace-nowrap"
															>
																{dockerState && (
																	<>
																		<DropdownMenuItem
																			className="focus:bg-muted focus:text-foreground"
																			onClick={() =>
																				handleCopyConnectionString(connection)
																			}
																		>
																			<Copy className="w-4 h-4" />
																			Copy connection string
																		</DropdownMenuItem>
																		{dockerState.status === "running" ? (
																			<DropdownMenuItem
																				className="focus:bg-muted focus:text-foreground"
																				onClick={() =>
																					handleDockerAction(connection, "stop")
																				}
																			>
																				<Stop className="w-4 h-4" />
																				Stop container
																			</DropdownMenuItem>
																		) : (
																			<DropdownMenuItem
																				className="focus:bg-muted focus:text-foreground"
																				onClick={() =>
																					handleDockerAction(
																						connection,
																						"start",
																					)
																				}
																			>
																				<Play className="w-4 h-4" />
																				Start container
																			</DropdownMenuItem>
																		)}
																		<DropdownMenuItem
																			className="focus:bg-muted focus:text-foreground"
																			onClick={() =>
																				handleDockerAction(
																					connection,
																					"restart",
																				)
																			}
																		>
																			<ArrowClockwise className="w-4 h-4" />
																			Restart container
																		</DropdownMenuItem>
																		<DropdownMenuSeparator className="my-1" />
																	</>
																)}
																<DropdownMenuItem
																	className="focus:bg-muted focus:text-foreground"
																	onClick={(e) => {
																		e.stopPropagation();
																		handleEditConnection(connection);
																	}}
																>
																	<PencilSimple className="w-4 h-4" />
																	Edit
																</DropdownMenuItem>
																<DropdownMenuItem
																	className="focus:bg-muted focus:text-foreground"
																	onClick={(e) => {
																		e.stopPropagation();
																		handleDuplicateConnection(connection);
																	}}
																>
																	<Copy className="w-4 h-4" />
																	Duplicate
																</DropdownMenuItem>
																<DropdownMenuItem
																	className="focus:bg-muted focus:text-foreground"
																	onClick={(e) => {
																		e.stopPropagation();
																		handleExportConnection(connection);
																	}}
																>
																	<Export className="w-4 h-4" />
																	Export
																</DropdownMenuItem>
																<DropdownMenuSeparator className="my-1" />
																<DropdownMenuItem
																	variant="destructive"
																	onClick={(e) => {
																		e.stopPropagation();
																		handleDeleteClick(connection);
																	}}
																>
																	<Trash className="w-4 h-4" />
																	Delete
																</DropdownMenuItem>
															</DropdownMenuContent>
														</DropdownMenu>
													</div>
												</div>
											</ContextMenuTrigger>
											<ContextMenuContent className="[&_[role=menuitem]]:cursor-pointer">
												<ContextMenuItem
													onClick={() => handleEditConnection(connection)}
												>
													<PencilSimple className="w-4 h-4" />
													Edit
												</ContextMenuItem>
												<ContextMenuItem
													onClick={() => handleDuplicateConnection(connection)}
												>
													<Copy className="w-4 h-4" />
													Duplicate
												</ContextMenuItem>
												<ContextMenuItem
													onClick={() => handleExportConnection(connection)}
												>
													<Export className="w-4 h-4" />
													Export
												</ContextMenuItem>
												<ContextMenuItem
													variant="destructive"
													onClick={() => handleDeleteClick(connection)}
												>
													<Trash className="w-4 h-4" />
													Delete
												</ContextMenuItem>
											</ContextMenuContent>
										</ContextMenu>
									);
								})}
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

				<AlertDialog
					open={!!deletingConnection}
					onOpenChange={(open) => !open && handleCancelDelete()}
				>
					<AlertDialogContent>
						<AlertDialogHeader>
							<AlertDialogTitle>Delete Connection</AlertDialogTitle>
							<AlertDialogDescription>
								Are you sure you want to delete "{deletingConnection?.name}"?
								The Docker container and its data are preserved by default.
							</AlertDialogDescription>
						</AlertDialogHeader>
						{deletingConnection && dockerStates[deletingConnection.uuid] && (
							<label className="flex items-start gap-3 rounded-lg border p-3 text-sm">
								<Checkbox
									checked={deleteDockerData}
									onCheckedChange={setDeleteDockerData}
									aria-label="Also delete Docker resources"
								/>
								<span>
									{dockerStates[deletingConnection.uuid].ownership === "created"
										? "Also delete the Docker container and its data volume"
										: "Also delete the Docker container and its anonymous volumes"}
									<span className="mt-1 block text-xs text-muted-foreground">
										Named volumes and bind mounts on linked containers are
										always preserved.
									</span>
								</span>
							</label>
						)}
						<AlertDialogFooter>
							<AlertDialogCancel disabled={isDeleting}>
								Cancel
							</AlertDialogCancel>
							<AlertDialogAction
								onClick={handleConfirmDelete}
								disabled={isDeleting}
								variant="destructive"
							>
								{isDeleting && <Spinner />}
								Delete
							</AlertDialogAction>
						</AlertDialogFooter>
					</AlertDialogContent>
				</AlertDialog>
			</main>
		</div>
	);
}
