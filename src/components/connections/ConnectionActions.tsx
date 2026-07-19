import {
	ArrowClockwise,
	Copy,
	DotsThreeVertical,
	Export,
	PencilSimple,
	Play,
	Stop,
	Trash,
} from "@phosphor-icons/react";
import { Fragment, type ReactNode } from "react";
import {
	ContextMenuContent,
	ContextMenuItem,
	ContextMenuSeparator,
} from "@/components/ui/context-menu";
import {
	DropdownMenu,
	DropdownMenuContent,
	DropdownMenuItem,
	DropdownMenuSeparator,
	DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import type { DockerConnectionState } from "@/types/docker";

type DockerAction = "start" | "stop" | "restart";

export interface ConnectionActionsProps {
	connectionName: string;
	dockerState?: DockerConnectionState;
	onCopyConnectionString: () => void;
	onDockerAction: (action: DockerAction) => void;
	onEdit: () => void;
	onDuplicate: () => void;
	onExport: () => void;
	onDelete: () => void;
}

interface MenuAction {
	id: string;
	label: string;
	icon: ReactNode;
	group: "docker" | "connection" | "danger";
	destructive?: boolean;
	run: () => void;
}

function actions({
	dockerState,
	onCopyConnectionString,
	onDockerAction,
	onEdit,
	onDuplicate,
	onExport,
	onDelete,
}: ConnectionActionsProps): MenuAction[] {
	const containerActions: MenuAction[] =
		dockerState?.status === "running"
			? [
					{
						id: "stop",
						label: "Stop container",
						icon: <Stop />,
						group: "docker",
						run: () => onDockerAction("stop"),
					},
					{
						id: "restart",
						label: "Restart container",
						icon: <ArrowClockwise />,
						group: "docker",
						run: () => onDockerAction("restart"),
					},
				]
			: dockerState?.status === "stopped"
				? [
						{
							id: "start",
							label: "Start container",
							icon: <Play />,
							group: "docker",
							run: () => onDockerAction("start"),
						},
						{
							id: "restart",
							label: "Restart container",
							icon: <ArrowClockwise />,
							group: "docker",
							run: () => onDockerAction("restart"),
						},
					]
				: [];
	return [
		...(dockerState
			? [
					{
						id: "copy-connection-string",
						label: "Copy connection string",
						icon: <Copy />,
						group: "docker" as const,
						run: onCopyConnectionString,
					},
					...containerActions,
				]
			: []),
		{
			id: "edit",
			label: "Edit",
			icon: <PencilSimple />,
			group: "connection",
			run: onEdit,
		},
		{
			id: "duplicate",
			label: "Duplicate",
			icon: <Copy />,
			group: "connection",
			run: onDuplicate,
		},
		{
			id: "export",
			label: "Export",
			icon: <Export />,
			group: "connection",
			run: onExport,
		},
		{
			id: "delete",
			label: "Delete",
			icon: <Trash />,
			group: "danger",
			destructive: true,
			run: onDelete,
		},
	];
}

export function ConnectionActionsDropdown(props: ConnectionActionsProps) {
	const items = actions(props);
	return (
		<DropdownMenu>
			<DropdownMenuTrigger
				onClick={(event) => event.stopPropagation()}
				className="pointer-events-auto shrink-0 cursor-pointer rounded-md p-1.5 text-muted-foreground opacity-0 transition-colors hover:bg-muted hover:text-foreground group-hover:opacity-100 group-focus-within:opacity-100"
				aria-label={`Actions for ${props.connectionName}`}
			>
				<DotsThreeVertical className="size-4" weight="bold" />
			</DropdownMenuTrigger>
			<DropdownMenuContent
				align="end"
				side="bottom"
				className="w-56 p-1.5 [&_[role=menuitem]]:cursor-pointer [&_[role=menuitem]]:whitespace-nowrap"
			>
				{items.map((action, index) => (
					<Fragment key={action.id}>
						{index > 0 && items[index - 1].group !== action.group && (
							<DropdownMenuSeparator className="my-1" />
						)}
						<DropdownMenuItem
							variant={action.destructive ? "destructive" : "default"}
							onClick={action.run}
						>
							{action.icon}
							{action.label}
						</DropdownMenuItem>
					</Fragment>
				))}
			</DropdownMenuContent>
		</DropdownMenu>
	);
}

export function ConnectionActionsContext(props: ConnectionActionsProps) {
	const items = actions(props);
	return (
		<ContextMenuContent className="w-56 p-1.5 [&_[role=menuitem]]:cursor-pointer [&_[role=menuitem]]:whitespace-nowrap">
			{items.map((action, index) => (
				<Fragment key={action.id}>
					{index > 0 && items[index - 1].group !== action.group && (
						<ContextMenuSeparator className="my-1" />
					)}
					<ContextMenuItem
						variant={action.destructive ? "destructive" : "default"}
						onClick={action.run}
					>
						{action.icon}
						{action.label}
					</ContextMenuItem>
				</Fragment>
			))}
		</ContextMenuContent>
	);
}
