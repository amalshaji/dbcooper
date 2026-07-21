import { Database, Lock } from "@phosphor-icons/react";
import {
	ConnectionActionsContext,
	ConnectionActionsDropdown,
} from "@/components/connections/ConnectionActions";
import { ClickhouseIcon } from "@/components/icons/clickhouse";
import { PostgresqlIcon } from "@/components/icons/postgres";
import { RedisIcon } from "@/components/icons/redis";
import { SqliteIcon } from "@/components/icons/sqlite";
import { Badge } from "@/components/ui/badge";
import { ContextMenu, ContextMenuTrigger } from "@/components/ui/context-menu";
import type { Connection } from "@/lib/tauri";
import type { DockerConnectionState } from "@/types/docker";

type DockerAction = "start" | "stop" | "restart";

interface ConnectionCardProps {
	connection: Connection;
	dockerState?: DockerConnectionState;
	onOpen: () => void;
	onCopyConnectionString: () => void;
	onDockerAction: (action: DockerAction) => void;
	onEdit: () => void;
	onDuplicate: () => void;
	onExport: () => void;
	onDelete: () => void;
}

function dbTypeConfig(type: string) {
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
}

export function ConnectionCard({
	connection,
	dockerState,
	onOpen,
	onCopyConnectionString,
	onDockerAction,
	onEdit,
	onDuplicate,
	onExport,
	onDelete,
}: ConnectionCardProps) {
	const config = dbTypeConfig(connection.type || "postgres");
	const DbIcon = config.icon;
	const actionProps = {
		connectionName: connection.name,
		dockerState,
		onCopyConnectionString,
		onDockerAction,
		onEdit,
		onDuplicate,
		onExport,
		onDelete,
	};

	return (
		<ContextMenu>
			<ContextMenuTrigger>
				<div className="group workspace-panel relative overflow-hidden rounded-lg border p-3.5 shadow-sm transition-[border-color,box-shadow,transform] duration-150 hover:-translate-y-px hover:border-foreground/20 hover:shadow-md focus-within:ring-2 focus-within:ring-ring/40">
					<button
						type="button"
						onClick={onOpen}
						onMouseDown={(event) => {
							if (event.button === 1) {
								event.preventDefault();
								onOpen();
							}
						}}
						aria-label={`Open ${connection.name}`}
						className="absolute inset-0 cursor-pointer rounded-lg outline-none"
					/>
					<div
						className={`absolute inset-y-3 left-0 w-0.5 rounded-r-full opacity-70 ${config.accentClass}`}
					/>
					<div className="pointer-events-none relative flex items-center gap-3 pl-1">
						<div
							className={`flex size-9 shrink-0 items-center justify-center rounded-md ${config.iconClass}`}
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
									? connection.file_path?.split("/").pop() || "Local file"
									: `${connection.host}:${connection.port}${connection.database ? ` • ${connection.database}` : ""}`}
							</p>
						</div>
						<ConnectionActionsDropdown {...actionProps} />
					</div>
				</div>
			</ContextMenuTrigger>
			<ConnectionActionsContext {...actionProps} />
		</ContextMenu>
	);
}
