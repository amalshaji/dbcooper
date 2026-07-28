import {
	ArrowClockwise,
	Check,
	Code,
	DotsThreeVertical,
	Table,
	Trash,
	TreeStructure,
	WarningCircle,
} from "@phosphor-icons/react";
import { Button } from "@/components/ui/button";
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
	DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
	SidebarGroup,
	SidebarGroupContent,
	SidebarGroupLabel,
	SidebarHeader,
	SidebarMenu,
	SidebarMenuButton,
	SidebarMenuItem,
} from "@/components/ui/sidebar";
import { Spinner } from "@/components/ui/spinner";
import { TabsContent } from "@/components/ui/tabs";
import { getConnectionDatabaseDisplay } from "@/lib/connectionPresentation";
import type { Connection, QueryHistory } from "@/lib/tauri";
import type { SavedQuery } from "@/lib/tauri";

export function ConnectionSidebarHeader({
	connection,
	refreshing,
	onOpenSchemaVisualizer,
	onRefresh,
}: {
	connection: Connection;
	refreshing: boolean;
	onOpenSchemaVisualizer: () => void;
	onRefresh: () => void;
}) {
	return (
		<SidebarHeader
			className="app-titlebar select-none border-b p-3 pt-10"
			data-tauri-drag-region
		>
			<div className="flex items-center justify-between gap-2">
				<div className="flex items-center gap-2 min-w-0 flex-1">
					<Table className="w-5 h-5 shrink-0" />
					<span className="font-semibold truncate">{connection.name}</span>
				</div>
				<div className="flex items-center gap-1 shrink-0">
					{connection.db_type !== "clickhouse" && (
						<Button
							variant="default"
							size="icon-sm"
							onClick={onOpenSchemaVisualizer}
							title="Open Schema Visualizer"
							aria-label="Open Schema Visualizer"
							className="h-7 w-7"
						>
							<TreeStructure className="w-4 h-4" />
						</Button>
					)}
					<Button
						variant="ghost"
						size="icon-sm"
						onClick={onRefresh}
						disabled={refreshing}
						title="Refresh schema"
						aria-label="Refresh schema"
					>
						{refreshing ? <Spinner /> : <ArrowClockwise className="w-4 h-4" />}
					</Button>
				</div>
			</div>
			<div className="text-xs text-muted-foreground mt-1">
				{connection.db_type === "duckdb"
					? connection.file_path
					: getConnectionDatabaseDisplay(connection)}
			</div>
		</SidebarHeader>
	);
}

export function SavedQueriesPanel({
	loading,
	queries,
	onLoad,
	onDelete,
}: {
	loading: boolean;
	queries: SavedQuery[];
	onLoad: (query: SavedQuery) => void;
	onDelete: (query: SavedQuery) => void;
}) {
	return (
		<TabsContent value="queries" className="mt-2 min-h-0 flex-1 overflow-auto">
			<SidebarGroup>
				<SidebarGroupLabel>Saved Queries</SidebarGroupLabel>
				<SidebarGroupContent>
					{loading ? (
						<div className="flex items-center justify-center py-4">
							<Spinner />
						</div>
					) : queries.length === 0 ? (
						<p className="text-xs text-muted-foreground px-2 py-4 text-center">
							No saved queries yet
						</p>
					) : (
						<SidebarMenu>
							{queries.map((query) => (
								<ContextMenu key={query.id}>
									<ContextMenuTrigger>
										<SidebarMenuItem className="group/query">
											<SidebarMenuButton
												onClick={() => onLoad(query)}
												className="pr-8"
											>
												<Code className="w-4 h-4" />
												<span className="truncate flex-1">{query.name}</span>
											</SidebarMenuButton>
											<DropdownMenu>
												<DropdownMenuTrigger
													render={
														<button
															type="button"
															className="absolute right-1 top-1/2 -translate-y-1/2 p-1 rounded opacity-0 group-hover/query:opacity-100 hover:bg-sidebar-accent"
															onClick={(event) => event.stopPropagation()}
														/>
													}
												>
													<DotsThreeVertical className="w-3 h-3" />
												</DropdownMenuTrigger>
												<DropdownMenuContent align="end">
													<DropdownMenuItem
														onClick={() => onDelete(query)}
														variant="destructive"
													>
														Delete
													</DropdownMenuItem>
												</DropdownMenuContent>
											</DropdownMenu>
										</SidebarMenuItem>
									</ContextMenuTrigger>
									<ContextMenuContent>
										<ContextMenuItem
											onClick={() => onDelete(query)}
											variant="destructive"
										>
											Delete
										</ContextMenuItem>
									</ContextMenuContent>
								</ContextMenu>
							))}
						</SidebarMenu>
					)}
				</SidebarGroupContent>
			</SidebarGroup>
		</TabsContent>
	);
}

function formatHistoryTime(executedAt: string): string {
	const iso = executedAt.includes("T")
		? executedAt
		: `${executedAt.replace(" ", "T")}Z`;
	const date = new Date(iso);
	if (Number.isNaN(date.getTime())) return executedAt;
	return date.toLocaleString();
}

export function QueryHistoryPanel({
	loading,
	history,
	onOpen,
	onClear,
}: {
	loading: boolean;
	history: QueryHistory[];
	onOpen: (query: string) => void;
	onClear: () => void;
}) {
	return (
		<TabsContent value="history" className="mt-2 min-h-0 flex-1 overflow-auto">
			<SidebarGroup>
				<div className="flex items-center justify-between pr-2">
					<SidebarGroupLabel>Recent Queries</SidebarGroupLabel>
					{history.length > 0 ? (
						<button
							type="button"
							className="text-xs text-muted-foreground hover:text-foreground flex items-center gap-1"
							onClick={onClear}
						>
							<Trash className="w-3 h-3" />
							Clear
						</button>
					) : null}
				</div>
				<SidebarGroupContent>
					{loading ? (
						<div className="flex items-center justify-center py-4">
							<Spinner />
						</div>
					) : history.length === 0 ? (
						<p className="text-xs text-muted-foreground px-2 py-4 text-center">
							No query history yet
						</p>
					) : (
						<SidebarMenu>
							{history.map((item) => (
								<SidebarMenuItem key={item.id}>
									<SidebarMenuButton
										onClick={() => onOpen(item.query)}
										className="h-auto flex-col items-start gap-1 py-2"
										title={item.error ?? item.query}
									>
										<div className="flex items-center gap-2 w-full">
											{item.status === "error" ? (
												<WarningCircle className="w-4 h-4 shrink-0 text-destructive group-hover/menu-button:text-sidebar-accent-foreground" />
											) : (
												<Check className="w-4 h-4 shrink-0 text-green-600 dark:text-green-500 group-hover/menu-button:text-sidebar-accent-foreground" />
											)}
											<span className="truncate flex-1 font-mono text-xs">
												{item.query}
											</span>
										</div>
										<div className="flex items-center gap-2 text-[10px] text-muted-foreground pl-6 group-hover/menu-button:text-sidebar-accent-foreground">
											<span>{formatHistoryTime(item.executed_at)}</span>
											{item.status === "success" &&
											item.time_taken_ms != null ? (
												<span>· {item.time_taken_ms} ms</span>
											) : null}
										</div>
									</SidebarMenuButton>
								</SidebarMenuItem>
							))}
						</SidebarMenu>
					)}
				</SidebarGroupContent>
			</SidebarGroup>
		</TabsContent>
	);
}
