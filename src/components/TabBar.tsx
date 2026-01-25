import { Tab } from "@/types/tabTypes";
import { X, Plus, Table, Code, Columns, Database } from "@phosphor-icons/react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { useRef, useEffect } from "react";

interface TabBarProps {
	tabs: Tab[];
	activeTabId: string | null;
	onTabSelect: (tabId: string) => void;
	onTabClose: (tabId: string) => void;
	onNewQuery: () => void;
}

function getTabIcon(tab: Tab) {
	switch (tab.type) {
		case "table-data":
			return <Table className="w-3.5 h-3.5" />;
		case "table-structure":
			return <Columns className="w-3.5 h-3.5" />;
		case "query":
			return <Code className="w-3.5 h-3.5" />;
		case "schema-visualizer":
			return <Database className="w-3.5 h-3.5" />;
		default:
			return null;
	}
}

export function TabBar({
	tabs,
	activeTabId,
	onTabSelect,
	onTabClose,
	onNewQuery,
}: TabBarProps) {
	const scrollContainerRef = useRef<HTMLDivElement>(null);
	const activeTabRef = useRef<HTMLButtonElement>(null);

	useEffect(() => {
		if (activeTabRef.current && scrollContainerRef.current) {
			activeTabRef.current.scrollIntoView({
				behavior: "auto",
				block: "nearest",
				inline: "nearest",
			});
		}
	}, [activeTabId]);

	if (tabs.length === 0) {
		return (
			<div className="flex items-center border-b bg-muted/30 px-2 h-10 sticky top-11 z-10">
				<Button
					variant="ghost"
					size="sm"
					onClick={onNewQuery}
					className="h-7 px-2 text-xs gap-1"
				>
					<Plus className="w-3.5 h-3.5" />
					New Query
				</Button>
			</div>
		);
	}

	return (
		<div className="flex items-center border-b bg-muted/30 sticky top-11 z-10">
			<div
				ref={scrollContainerRef}
				className="flex-1 flex items-end overflow-x-auto scrollbar-thin scrollbar-thumb-muted scrollbar-track-transparent"
			>
				{tabs.map((tab) => {
					const isActive = tab.id === activeTabId;
					return (
						<button
							key={tab.id}
							ref={isActive ? activeTabRef : null}
							onClick={() => onTabSelect(tab.id)}
							onMouseDown={(e) => {
								if (e.button === 1) {
									e.preventDefault();
									onTabClose(tab.id);
								}
							}}
							className={cn(
								"group relative flex items-center gap-1.5 px-3 py-2 text-xs border-r border-border/50 max-w-[180px] min-w-[100px]",
								"hover:bg-background/50 transition-colors",
								isActive
									? "bg-background border-t-2 border-t-primary text-foreground"
									: "text-muted-foreground",
							)}
						>
							{getTabIcon(tab)}
							<span className="truncate flex-1 text-left">{tab.title}</span>
							<span
								role="button"
								tabIndex={0}
								onClick={(e) => {
									e.stopPropagation();
									onTabClose(tab.id);
								}}
								onKeyDown={(e) => {
									if (e.key === "Enter" || e.key === " ") {
										e.stopPropagation();
										onTabClose(tab.id);
									}
								}}
								className={cn(
									"p-0.5 rounded hover:bg-muted transition-colors",
									isActive
										? "opacity-100"
										: "opacity-0 group-hover:opacity-100",
								)}
							>
								<X className="w-3 h-3" />
							</span>
						</button>
					);
				})}
			</div>
			<div className="flex-shrink-0 px-1 border-l border-border/50">
				<Button
					variant="ghost"
					size="icon-sm"
					onClick={onNewQuery}
					className="h-7 w-7"
					title="New Query"
				>
					<Plus className="w-3.5 h-3.5" />
				</Button>
			</div>
		</div>
	);
}
