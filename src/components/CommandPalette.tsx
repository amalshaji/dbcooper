import { useEffect } from "react";
import {
	CommandDialog,
	CommandEmpty,
	CommandGroup,
	CommandInput,
	CommandItem,
	CommandList,
	CommandSeparator,
	CommandShortcut,
} from "@/components/ui/command";
import {
	ArrowLeft,
	Code,
	Table,
	Columns,
	FloppyDisk,
	ArrowsClockwise,
	DownloadSimple,
	Graph,
	Database,
	X,
	Gear,
} from "@phosphor-icons/react";
import type { Tab } from "@/types/tabTypes";

interface CommandPaletteProps {
	open: boolean;
	onOpenChange: (open: boolean) => void;
	activeTab: Tab | null;
	tabs: Tab[];
	onNavigateBack: () => void;
	onToggleSidebar: () => void;
	onNewQuery: () => void;
	onCloseTab: (tabId: string) => void;
	onNextTab: () => void;
	onPreviousTab: () => void;
	onRunQuery: () => void;
	onSaveQuery: () => void;
	onRefresh: () => void;
	onExportCSV: () => void;
	onClearFilter: () => void;
	onOpenSchemaVisualizer: () => void;
	onSwitchSidebarTab: (tab: "tables" | "queries") => void;
	onOpenSettings: () => void;
	connectionType?: string;
}

function getShortcutKey(key: string): string {
	if (typeof window !== "undefined" && navigator.platform.includes("Mac")) {
		return key.replace("Cmd", "⌘").replace("Ctrl", "⌃");
	}
	return key.replace("Cmd", "Ctrl");
}

export function CommandPalette({
	open,
	onOpenChange,
	activeTab,
	tabs,
	onNavigateBack,
	onToggleSidebar,
	onNewQuery,
	onCloseTab,
	onNextTab,
	onPreviousTab,
	onRunQuery,
	onSaveQuery,
	onRefresh,
	onExportCSV,
	onClearFilter,
	onOpenSchemaVisualizer,
	onSwitchSidebarTab,
	onOpenSettings,
	connectionType,
}: CommandPaletteProps) {
	const isQueryTab = activeTab?.type === "query";
	const isTableDataTab = activeTab?.type === "table-data";
	const hasResults =
		isQueryTab &&
		activeTab &&
		"results" in activeTab &&
		activeTab.results &&
		activeTab.results.length > 0;
	const hasFilter =
		isTableDataTab && activeTab && "filter" in activeTab && activeTab.filter;

	useEffect(() => {
		const down = (e: KeyboardEvent) => {
			if (e.key === "k" && (e.metaKey || e.ctrlKey)) {
				e.preventDefault();
				onOpenChange(!open);
			}
			if (e.key === "Escape" && open) {
				e.preventDefault();
				onOpenChange(false);
			}
			// Cmd+, to open Settings
			if (e.key === "," && (e.metaKey || e.ctrlKey)) {
				e.preventDefault();
				onOpenSettings();
			}
		};

		document.addEventListener("keydown", down);
		return () => document.removeEventListener("keydown", down);
	}, [open, onOpenChange, onOpenSettings]);

	return (
		<CommandDialog open={open} onOpenChange={onOpenChange}>
			<CommandInput placeholder="Type a command or search..." />
			<CommandList>
				<CommandEmpty>No results found.</CommandEmpty>

				<CommandGroup heading="Navigation">
					<CommandItem
						onSelect={() => {
							onNavigateBack();
							onOpenChange(false);
						}}
					>
						<ArrowLeft className="w-4 h-4" />
						<span>Go Back</span>
						<CommandShortcut>{getShortcutKey("Cmd+Backspace")}</CommandShortcut>
					</CommandItem>
					<CommandItem
						onSelect={() => {
							onToggleSidebar();
							onOpenChange(false);
						}}
					>
						<Table className="w-4 h-4" />
						<span>Toggle Sidebar</span>
						<CommandShortcut>{getShortcutKey("Cmd+B")}</CommandShortcut>
					</CommandItem>
				</CommandGroup>

				<CommandSeparator />

				<CommandGroup heading="Tabs">
					<CommandItem
						onSelect={() => {
							onNewQuery();
							onOpenChange(false);
						}}
					>
						<Code className="w-4 h-4" />
						<span>New Query</span>
						<CommandShortcut>{getShortcutKey("Cmd+N")}</CommandShortcut>
					</CommandItem>
					{activeTab && (
						<CommandItem
							onSelect={() => {
								onCloseTab(activeTab.id);
								onOpenChange(false);
							}}
						>
							<X className="w-4 h-4" />
							<span>Close Tab</span>
							<CommandShortcut>{getShortcutKey("Cmd+W")}</CommandShortcut>
						</CommandItem>
					)}
					{tabs.length > 1 && (
						<>
							<CommandItem
								onSelect={() => {
									onNextTab();
									onOpenChange(false);
								}}
							>
								<ArrowLeft className="w-4 h-4 rotate-180" />
								<span>Next Tab</span>
								<CommandShortcut>{getShortcutKey("Cmd+]")}</CommandShortcut>
							</CommandItem>
							<CommandItem
								onSelect={() => {
									onPreviousTab();
									onOpenChange(false);
								}}
							>
								<ArrowLeft className="w-4 h-4" />
								<span>Previous Tab</span>
								<CommandShortcut>{getShortcutKey("Cmd+[")}</CommandShortcut>
							</CommandItem>
						</>
					)}
				</CommandGroup>

				<CommandSeparator />

				{isQueryTab && (
					<CommandGroup heading="Query">
						<CommandItem
							onSelect={() => {
								onRunQuery();
								onOpenChange(false);
							}}
						>
							<Code className="w-4 h-4" />
							<span>Run Query</span>
							<CommandShortcut>{getShortcutKey("Cmd+Enter")}</CommandShortcut>
						</CommandItem>
						<CommandItem
							onSelect={() => {
								onSaveQuery();
								onOpenChange(false);
							}}
						>
							<FloppyDisk className="w-4 h-4" />
							<span>Save Query</span>
							<CommandShortcut>{getShortcutKey("Cmd+S")}</CommandShortcut>
						</CommandItem>
					</CommandGroup>
				)}

				{(isQueryTab || isTableDataTab) && (
					<CommandGroup heading="Data">
						<CommandItem
							onSelect={() => {
								onRefresh();
								onOpenChange(false);
							}}
						>
							<ArrowsClockwise className="w-4 h-4" />
							<span>Refresh</span>
							<CommandShortcut>{getShortcutKey("Cmd+R")}</CommandShortcut>
						</CommandItem>
						{hasResults && (
							<CommandItem
								onSelect={() => {
									onExportCSV();
									onOpenChange(false);
								}}
							>
								<DownloadSimple className="w-4 h-4" />
								<span>Export CSV</span>
								<CommandShortcut>{getShortcutKey("Cmd+E")}</CommandShortcut>
							</CommandItem>
						)}
						{hasFilter && (
							<CommandItem
								onSelect={() => {
									onClearFilter();
									onOpenChange(false);
								}}
							>
								<X className="w-4 h-4" />
								<span>Clear Filter</span>
								<CommandShortcut>
									{getShortcutKey("Cmd+Shift+X")}
								</CommandShortcut>
							</CommandItem>
						)}
					</CommandGroup>
				)}

				{connectionType !== "redis" && connectionType !== "clickhouse" && (
					<CommandGroup heading="Schema">
						<CommandItem
							onSelect={() => {
								onOpenSchemaVisualizer();
								onOpenChange(false);
							}}
						>
							<Graph className="w-4 h-4" />
							<span>Schema Visualizer</span>
							<CommandShortcut>{getShortcutKey("Cmd+Shift+V")}</CommandShortcut>
						</CommandItem>
					</CommandGroup>
				)}

				<CommandSeparator />

				<CommandGroup heading="Sidebar">
					<CommandItem
						onSelect={() => {
							onSwitchSidebarTab("tables");
							onOpenChange(false);
						}}
					>
						<Table className="w-4 h-4" />
						<span>Tables Tab</span>
						<CommandShortcut>{getShortcutKey("Cmd+1")}</CommandShortcut>
					</CommandItem>
					<CommandItem
						onSelect={() => {
							onSwitchSidebarTab("queries");
							onOpenChange(false);
						}}
					>
						<Code className="w-4 h-4" />
						<span>Queries Tab</span>
						<CommandShortcut>{getShortcutKey("Cmd+2")}</CommandShortcut>
					</CommandItem>
				</CommandGroup>

				<CommandSeparator />

				<CommandGroup heading="Application">
					<CommandItem
						onSelect={() => {
							onOpenSettings();
							onOpenChange(false);
						}}
					>
						<Gear className="w-4 h-4" />
						<span>Settings</span>
						<CommandShortcut>{getShortcutKey("Cmd+,")}</CommandShortcut>
					</CommandItem>
				</CommandGroup>
			</CommandList>
		</CommandDialog>
	);
}
