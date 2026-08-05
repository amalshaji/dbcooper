import { Gear, X } from "@phosphor-icons/react";
import { ConnectionStatus } from "@/components/ConnectionStatus";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { SidebarTrigger, useSidebar } from "@/components/ui/sidebar";
import type { Connection } from "@/lib/tauri";
import { getConnectionDisplayEndpoint } from "@/lib/connectionCapabilities";
import type { SqlConnection } from "@/types/connection";

interface ConnectionHeaderProps<TConnection extends Connection = Connection> {
	connection: TConnection;
	connectionStatus: "connected" | "disconnected";
	onClose: () => void;
	onReconnect: () => Promise<void>;
	onStatusChange: (status: "connected" | "disconnected") => void;
	onOpenSettings: () => void;
}

export function ConnectionHeader({
	connection,
	connectionStatus,
	onClose,
	onReconnect,
	onStatusChange,
	onOpenSettings,
}: ConnectionHeaderProps<SqlConnection>) {
	const { state } = useSidebar();
	const isCollapsed = state === "collapsed";

	return (
		<header
			data-tauri-drag-region
			className={`app-titlebar sticky top-0 z-20 flex h-12 shrink-0 select-none items-center gap-2 border-b px-4 ${
				isCollapsed ? "pl-20" : ""
			}`}
		>
			<SidebarTrigger className="-ml-1" />
			<div className="flex flex-1 items-center gap-2">
				<Button variant="ghost" size="sm" onClick={onClose}>
					<X className="size-4" />
					Close connection
				</Button>
			</div>
			<div className="flex items-center gap-2">
				<ConnectionStatus
					connectionUuid={connection.uuid}
					status={connectionStatus}
					onReconnect={onReconnect}
					onStatusChange={onStatusChange}
				/>
				<Badge variant="secondary" className="h-5 px-2 text-[10px] capitalize">
					{connection.type}
				</Badge>
				<Badge
					variant={connection.ssl ? "default" : "secondary"}
					className="h-5 px-2 text-[10px]"
				>
					SSL: {connection.ssl ? "Yes" : "No"}
				</Badge>
				<Button
					variant="ghost"
					size="icon-sm"
					onClick={onOpenSettings}
					aria-label="Open connection settings"
					title="Connection settings"
				>
					<Gear className="size-4" />
				</Button>
			</div>
		</header>
	);
}

export function ConnectionWorkspaceHeader({
	connection,
	connectionStatus,
	onClose,
	onReconnect,
	onStatusChange,
	onOpenSettings,
}: ConnectionHeaderProps) {
	return (
		<header
			data-tauri-drag-region
			className="app-titlebar sticky top-0 z-20 flex h-12 shrink-0 select-none items-center border-b pl-20 pr-4"
		>
			<div className="ml-4 flex flex-1 items-center gap-2">
				<Button variant="ghost" size="sm" onClick={onClose}>
					<X className="size-4" />
					Close connection
				</Button>
				<span className="text-sm font-semibold">{connection.name}</span>
				<span className="text-xs text-muted-foreground">
					{getConnectionDisplayEndpoint(connection)}
				</span>
			</div>
			<div className="flex items-center gap-2">
				<ConnectionStatus
					connectionUuid={connection.uuid}
					status={connectionStatus}
					onReconnect={onReconnect}
					onStatusChange={onStatusChange}
				/>
				<Badge variant="secondary" className="h-5 px-2 text-[10px] capitalize">
					{connection.type}
				</Badge>
				<Button
					variant="ghost"
					size="icon-sm"
					onClick={onOpenSettings}
					aria-label="Open connection settings"
					title="Connection settings"
				>
					<Gear className="size-4" />
				</Button>
			</div>
		</header>
	);
}
