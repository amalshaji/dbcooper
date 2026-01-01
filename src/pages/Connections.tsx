import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { EmptyState } from "@/components/EmptyState";
import { ConnectionForm } from "@/components/ConnectionForm";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
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
import {
	Database,
	Gear,
	GithubLogo,
	PencilSimple,
	Trash,
	Plus,
	DotsThreeVertical,
	Lock,
	Copy,
} from "@phosphor-icons/react";
import {
	DropdownMenu,
	DropdownMenuContent,
	DropdownMenuItem,
	DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

import { PostgresqlIcon } from "@/components/icons/postgres";
import { RedisIcon } from "@/components/icons/redis";
import { SqliteIcon } from "@/components/icons/sqlite";
import { ClickhouseIcon } from "@/components/icons/clickhouse";

import { api, type Connection, type ConnectionFormData } from "@/lib/tauri";
import { Spinner } from "@/components/ui/spinner";
import { UpdateChecker } from "@/components/UpdateChecker";
import { handleDragStart } from "@/lib/windowDrag";

// Database type icons and colors
const getDbTypeConfig = (type: string) => {
	switch (type) {
		case "postgres":
			return {
				icon: PostgresqlIcon,
				gradient: "from-blue-500/20 to-cyan-500/20",
				borderColor: "group-hover:border-blue-500/50",
			};
		case "mysql":
			return {
				icon: Database,
				gradient: "from-orange-500/20 to-yellow-500/20",
				borderColor: "group-hover:border-orange-500/50",
			};
		case "sqlite":
			return {
				icon: SqliteIcon,
				gradient: "from-emerald-500/20 to-teal-500/20",
				borderColor: "group-hover:border-emerald-500/50",
			};
		case "redis":
			return {
				icon: RedisIcon,
				gradient: "from-red-500/20 to-rose-500/20",
				borderColor: "group-hover:border-red-500/50",
			};
		case "clickhouse":
			return {
				icon: ClickhouseIcon,
				gradient: "from-yellow-400/20 to-yellow-500/20",
				borderColor: "group-hover:border-yellow-400/50",
			};
		default:
			return {
				icon: Database,
				gradient: "from-primary/20 to-accent/20",
				borderColor: "group-hover:border-primary/50",
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

	const fetchConnections = async () => {
		try {
			const data = await api.connections.list();
			setConnections(data);
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
		setDeletingConnection(connection);
	};

	const handleConfirmDelete = async () => {
		if (!deletingConnection) return;

		setIsDeleting(true);
		try {
			await api.connections.delete(deletingConnection.id);
			await fetchConnections();
			setDeletingConnection(null);
		} catch (error) {
			console.error("Failed to delete connection:", error);
		} finally {
			setIsDeleting(false);
		}
	};

	const handleCancelDelete = () => {
		setDeletingConnection(null);
	};

	const handleDuplicateConnection = async (connection: Connection) => {
		try {
			// Create a copy of the connection data without the id and uuid
			const {
				id,
				uuid,
				name,
				created_at,
				updated_at,
				ssh_use_key,
				...connectionData
			} = connection;
			const duplicatedData: ConnectionFormData = {
				...connectionData,
				name: `${name} (Copy)`,
				ssl: Boolean(connection.ssl),
				ssh_enabled: connection.ssh_enabled
					? Boolean(connection.ssh_enabled)
					: undefined,
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

	if (loading) {
		return (
			<div className="flex items-center justify-center min-h-screen bg-background">
				<div className="flex flex-col items-center gap-3">
					<Spinner className="w-8 h-8" />
					<p className="text-sm text-muted-foreground">
						Loading connections...
					</p>
				</div>
			</div>
		);
	}

	return (
		<div className="min-h-screen bg-background flex flex-col">
			{/* Titlebar region */}
			<header
				onMouseDown={handleDragStart}
				className="h-12 shrink-0 flex items-center justify-between gap-2 px-4 pl-20 border-b bg-background/80 backdrop-blur-sm"
			>
				<div className="flex items-center gap-2">
					<h1 className="text-sm font-medium text-foreground">Connections</h1>
					<Badge variant="secondary" className="text-xs">
						{connections.length}
					</Badge>
				</div>
				<div className="flex items-center gap-1">
					<UpdateChecker />
					<a
						href="https://github.com/amalshaji/dbcooper"
						target="_blank"
						rel="noopener noreferrer"
						className="inline-flex items-center justify-center h-8 w-8 rounded-lg hover:bg-accent/50 transition-all duration-200"
						title="View on GitHub"
					>
						<GithubLogo className="w-4 h-4" />
					</a>

					<button
						type="button"
						onClick={() => navigate("/settings")}
						className="inline-flex items-center justify-center h-8 w-8 rounded-lg hover:bg-accent/50 transition-all duration-200"
						title="Settings"
					>
						<Gear className="w-4 h-4" />
					</button>
				</div>
			</header>

			<div className="flex-1 p-6 overflow-auto">
				<div className="max-w-2xl mx-auto">
					{connections.length === 0 ? (
						<div className="flex items-center justify-center min-h-[60vh]">
							<EmptyState
								icon={<Database className="w-16 h-16" />}
								title="No connections yet"
								description="Get started by creating your first database connection. You can connect to PostgreSQL, MySQL, SQLite, or Redis."
								action={{
									label: "Create Connection",
									onClick: () => setIsFormOpen(true),
								}}
							/>
						</div>
					) : (
						<div className="space-y-4">
							{/* Header */}
							<div className="flex items-center justify-between">
								<div>
									<h2 className="text-xl font-semibold tracking-tight">
										Your Databases
									</h2>
									<p className="text-xs text-muted-foreground mt-0.5">
										Click on a connection to explore
									</p>
								</div>
								<Button
									onClick={() => setIsFormOpen(true)}
									size="sm"
									className="gap-1.5 shadow-md shadow-primary/20 hover:shadow-primary/30 transition-shadow duration-300"
								>
									<Plus className="w-4 h-4" weight="bold" />
									New
								</Button>
							</div>

							{/* Connection Cards - Compact List */}
							<div className="space-y-2">
								{connections.map((connection) => {
									const dbConfig = getDbTypeConfig(
										connection.type || "postgres",
									);
									const DbIcon = dbConfig.icon;

									return (
										<div
											key={connection.id}
											role="button"
											tabIndex={0}
											onClick={() =>
												navigate(`/connections/${connection.uuid}`)
											}
											onKeyDown={(e) => {
												if (e.key === "Enter" || e.key === " ") {
													e.preventDefault();
													navigate(`/connections/${connection.uuid}`);
												}
											}}
											className={`group relative cursor-pointer rounded-lg border bg-card shadow-sm p-3 transition-all duration-200 hover:shadow-md hover:shadow-black/5 dark:hover:shadow-black/20 hover:-translate-y-0.5 focus:outline-none focus:ring-2 focus:ring-primary/50 ${dbConfig.borderColor}`}
										>
											{/* Gradient Background */}
											<div
												className={`absolute inset-0 rounded-lg bg-gradient-to-br ${dbConfig.gradient} opacity-0 group-hover:opacity-100 transition-opacity duration-200`}
											/>

											{/* Content */}
											<div className="relative flex items-center gap-3">
												{/* Database Icon */}
												<div className="shrink-0 p-2 rounded-md bg-muted/50">
													<DbIcon className="w-4 h-4" />
												</div>

												{/* Connection Info */}
												<div className="flex-1 min-w-0">
													<div className="flex items-center gap-2">
														<h3 className="font-medium text-sm truncate group-hover:text-primary transition-colors duration-200">
															{connection.name}
														</h3>
														<Badge
															variant="secondary"
															className="capitalize text-[10px] px-1.5 py-0 shrink-0"
														>
															{connection.type || "postgres"}
														</Badge>
														{connection.ssl === 1 && (
															<Lock
																className="w-3 h-3 text-muted-foreground shrink-0"
																weight="fill"
															/>
														)}
													</div>
													<p className="text-xs text-muted-foreground truncate mt-0.5">
														{connection.type === "sqlite"
															? connection.file_path?.split("/").pop() ||
																"Local file"
															: `${connection.host}:${connection.port}${connection.database ? ` • ${connection.database}` : ""}`}
													</p>
												</div>

												{/* Actions Menu */}
												<DropdownMenu>
													<DropdownMenuTrigger
														onClick={(e) => e.stopPropagation()}
														className="p-1.5 rounded-md hover:bg-muted/80 transition-colors opacity-0 group-hover:opacity-100 shrink-0"
													>
														<DotsThreeVertical
															className="w-4 h-4"
															weight="bold"
														/>
													</DropdownMenuTrigger>
													<DropdownMenuContent align="end" side="bottom">
														<DropdownMenuItem
															onClick={(e) => {
																e.stopPropagation();
																handleEditConnection(connection);
															}}
														>
															<PencilSimple className="w-4 h-4" />
															Edit
														</DropdownMenuItem>
														<DropdownMenuItem
															onClick={(e) => {
																e.stopPropagation();
																handleDuplicateConnection(connection);
															}}
														>
															<Copy className="w-4 h-4" />
															Duplicate
														</DropdownMenuItem>
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

				<AlertDialog
					open={!!deletingConnection}
					onOpenChange={(open) => !open && handleCancelDelete()}
				>
					<AlertDialogContent>
						<AlertDialogHeader>
							<AlertDialogTitle>Delete Connection</AlertDialogTitle>
							<AlertDialogDescription>
								Are you sure you want to delete "{deletingConnection?.name}"?
								This action cannot be undone.
							</AlertDialogDescription>
						</AlertDialogHeader>
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
			</div>
		</div>
	);
}
