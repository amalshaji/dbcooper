import { Pulse, X } from "@phosphor-icons/react";
import { type ReactNode, useCallback, useState } from "react";
import { Button } from "@/components/ui/button";
import {
	type NativeCloseTarget,
	useNativeCloseListener,
} from "@/hooks/connection-details/useNativeCloseListener";
import { cn } from "@/lib/utils";
import type { Connection } from "@/types/connection";
import { LogsWorkspace } from "./LogsWorkspace";

interface WorkspaceLogsNavigationProps {
	connection: Connection;
	workspaceLabel: string;
	workspaceCloseTarget: NativeCloseTarget;
	children: ReactNode;
}

export function WorkspaceLogsNavigation({
	connection,
	workspaceLabel,
	workspaceCloseTarget,
	children,
}: WorkspaceLogsNavigationProps) {
	const [logsOpen, setLogsOpen] = useState(false);
	const [activeView, setActiveView] = useState<"workspace" | "logs">(
		"workspace",
	);
	const closeLogs = useCallback(() => {
		setLogsOpen(false);
		setActiveView("workspace");
	}, []);
	useNativeCloseListener(
		activeView === "logs"
			? { kind: "action", close: closeLogs }
			: workspaceCloseTarget,
	);

	return (
		<div className="flex min-h-0 flex-1 flex-col">
		<nav
			aria-label="Workspace views"
			className="toolbar-material flex h-10 shrink-0 items-stretch border-b"
		>
			<button
				type="button"
				onClick={() => setActiveView("workspace")}
				className={cn(
					"min-w-28 border-r px-3 text-left text-xs outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring/50",
					activeView === "workspace"
						? "bg-background text-foreground shadow-[inset_0_2px_0_var(--primary)]"
						: "text-muted-foreground hover:bg-background/60 hover:text-foreground",
				)}
			>
				{workspaceLabel}
			</button>
			{logsOpen ? (
				<div
					className={cn(
						"group flex min-w-28 items-center border-r text-xs",
						activeView === "logs"
							? "bg-background text-foreground shadow-[inset_0_2px_0_var(--primary)]"
							: "text-muted-foreground hover:bg-background/60 hover:text-foreground",
					)}
				>
					<button
						type="button"
						onClick={() => setActiveView("logs")}
						className="flex min-w-0 flex-1 items-center gap-1.5 self-stretch px-3 text-left outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring/50"
					>
						<Pulse className="size-3.5" />
						Logs
					</button>
					<button
						type="button"
						onClick={closeLogs}
						aria-label="Close Logs"
						className="mr-1 flex size-6 items-center justify-center rounded-md outline-none hover:bg-muted focus-visible:ring-2 focus-visible:ring-ring/50"
					>
						<X className="size-3" />
					</button>
				</div>
			) : null}
			{!logsOpen ? (
				<div className="ml-auto flex items-center border-l px-1">
					<Button
						variant="ghost"
						size="sm"
						className="h-7 text-xs"
						onClick={() => {
							setLogsOpen(true);
							setActiveView("logs");
						}}
					>
						<Pulse className="size-3.5" />
						Open logs
					</Button>
				</div>
			) : null}
		</nav>
		<div
			className={cn(
				"flex min-h-0 flex-1 flex-col",
				activeView !== "workspace" && "hidden",
			)}
		>
			{children}
		</div>
		{logsOpen && activeView === "logs" ? (
			<div className="min-h-0 flex-1 p-3">
				<LogsWorkspace connection={connection} />
			</div>
		) : null}
	</div>
	);
}
