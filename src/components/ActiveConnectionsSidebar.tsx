import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Database, Plus } from "@phosphor-icons/react";
import { api, type Connection } from "@/lib/tauri";
import { useActiveConnections } from "@/contexts/ActiveConnectionsContext";
import { Button } from "@/components/ui/button";
import {
	CommandDialog,
	CommandEmpty,
	CommandGroup,
	CommandInput,
	CommandItem,
	CommandList,
} from "@/components/ui/command";
import { Spinner } from "@/components/ui/spinner";
import {
	Tooltip,
	TooltipContent,
	TooltipTrigger,
} from "@/components/ui/tooltip";
import { PostgresqlIcon } from "@/components/icons/postgres";
import { RedisIcon } from "@/components/icons/redis";
import { SqliteIcon } from "@/components/icons/sqlite";
import { ClickhouseIcon } from "@/components/icons/clickhouse";

const getDbTypeIcon = (type: string) => {
	switch (type) {
		case "postgres":
			return PostgresqlIcon;
		case "sqlite":
			return SqliteIcon;
		case "redis":
			return RedisIcon;
		case "clickhouse":
			return ClickhouseIcon;
		default:
			return null;
	}
};

export function ActiveConnectionsSidebar() {
	const navigate = useNavigate();
	const {
		activeIds,
		activeId,
		connectionsById,
		addActive,
		setActive,
		cacheConnection,
	} = useActiveConnections();
	const [pickerOpen, setPickerOpen] = useState(false);
	const [allConnections, setAllConnections] = useState<Connection[]>([]);
	const [loadingConnections, setLoadingConnections] = useState(false);

	useEffect(() => {
		if (!pickerOpen) return;

		let isMounted = true;
		const loadConnections = async () => {
			setLoadingConnections(true);
			try {
				const data = await api.connections.list();
				if (isMounted) {
					setAllConnections(data);
				}
			} catch (error) {
				console.error("Failed to load connections:", error);
			} finally {
				if (isMounted) {
					setLoadingConnections(false);
				}
			}
		};

		loadConnections();
		return () => {
			isMounted = false;
		};
	}, [pickerOpen]);

	const activeConnections = useMemo(
		() =>
			activeIds.map((uuid) => ({
				uuid,
				connection: connectionsById[uuid],
			})),
		[activeIds, connectionsById],
	);

	const handleSelectConnection = (connection: Connection) => {
		cacheConnection(connection);
		addActive(connection.uuid);
		setActive(connection.uuid);
		setPickerOpen(false);
		navigate(`/connections/${connection.uuid}`);
	};

	const getFallbackIcon = () => Database;

	return (
		<div className="w-12 bg-sidebar text-sidebar-foreground flex flex-col relative">
			<div className="absolute top-10 bottom-0 right-0 w-px bg-sidebar-border" />
			<div className="flex-1 overflow-auto p-1.5 pt-10">
				<div className="space-y-0.5">
					{activeConnections.length === 0 ? (
						<div className="text-[10px] text-sidebar-foreground/60 text-center px-1 py-2">
							None
						</div>
					) : (
						activeConnections.map(({ uuid, connection }) => {
							const type = connection?.type || "unknown";
							const isActive = uuid === activeId;
							const DbIcon = getDbTypeIcon(type) || getFallbackIcon();
							const tooltipLabel =
								connection?.name
									? `${connection.name} (${type})`
									: `${uuid.slice(0, 8)} (${type})`;

							return (
								<Tooltip key={uuid}>
									<TooltipTrigger
										render={
											<button
												type="button"
												onClick={() => {
													setActive(uuid);
													navigate(`/connections/${uuid}`);
												}}
												className={`w-full rounded-md px-1.5 py-1.5 text-xs transition-colors duration-75 ${
													isActive
														? "bg-sidebar-primary text-sidebar-primary-foreground shadow-sm ring-1 ring-sidebar-ring/40"
														: "bg-sidebar/40 hover:bg-sidebar-accent/60 text-sidebar-foreground"
												}`}
											>
												<div className="flex items-center justify-center">
													<DbIcon
														className={`w-3.5 h-3.5 ${
															isActive
																? "text-sidebar-primary-foreground"
																: "text-sidebar-foreground"
														}`}
													/>
												</div>
											</button>
										}
									/>
									<TooltipContent side="right">
										{tooltipLabel}
									</TooltipContent>
								</Tooltip>
							);
						})
					)}
				</div>
			</div>
			<div className="p-1 border-t">
				<Tooltip>
					<TooltipTrigger
						render={
							<Button
								variant="ghost"
								size="icon-sm"
								onClick={() => setPickerOpen(true)}
								className="w-full text-sidebar-foreground"
							>
								<Plus className="w-3.5 h-3.5" />
							</Button>
						}
					/>
					<TooltipContent side="right">Add connection</TooltipContent>
				</Tooltip>
			</div>

			<CommandDialog
				open={pickerOpen}
				onOpenChange={setPickerOpen}
				title="Add connection"
				description="Choose a saved connection to add"
			>
				<CommandInput placeholder="Search connections..." />
				<CommandList>
					{loadingConnections && (
						<div className="flex items-center justify-center py-6">
							<Spinner />
						</div>
					)}
					{!loadingConnections && allConnections.length === 0 && (
						<CommandEmpty>No connections found.</CommandEmpty>
					)}
					{!loadingConnections && allConnections.length > 0 && (
						<CommandGroup heading="Connections">
							{allConnections.map((connection) => (
								<CommandItem
									key={connection.uuid}
									onSelect={() => handleSelectConnection(connection)}
								>
									<span className="truncate">{connection.name}</span>
									<span className="text-[10px] text-muted-foreground capitalize">
										{connection.type}
									</span>
								</CommandItem>
							))}
						</CommandGroup>
					)}
				</CommandList>
			</CommandDialog>
		</div>
	);
}
