import { Code, Columns, Database, Plus, Table, X } from "@phosphor-icons/react";
import { useEffect, useRef } from "react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import type { Tab } from "@/types/tabTypes";

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
		case "function-definition":
			return <Code className="w-3.5 h-3.5" />;
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
				behavior: "smooth",
				block: "nearest",
				inline: "nearest",
			});
		}
	}, [activeTabId]);

	if (tabs.length === 0) {
		return (
			<div className="toolbar-material sticky top-12 z-10 flex h-10 items-center border-b px-2">
				<Button
					variant="ghost"
					size="sm"
					onClick={onNewQuery}
					className="h-7 px-2 text-xs"
				>
					<Plus className="size-3.5" />
					New query
				</Button>
			</div>
		);
	}

	return (
		<div className="toolbar-material sticky top-12 z-10 flex h-10 items-stretch border-b">
			<div
				ref={scrollContainerRef}
				className="flex min-w-0 flex-1 items-stretch overflow-x-auto scrollbar-thin scrollbar-track-transparent scrollbar-thumb-muted"
			>
				{tabs.map((tab) => {
					const isActive = tab.id === activeTabId;
					return (
						<div
							key={tab.id}
							className={cn(
								"group relative flex min-w-[108px] max-w-[200px] items-center border-r border-border/70 text-xs transition-colors",
								isActive
									? "bg-background text-foreground shadow-[inset_0_2px_0_var(--primary)]"
									: "text-muted-foreground hover:bg-background/60 hover:text-foreground",
							)}
						>
							<button
								type="button"
								ref={isActive ? activeTabRef : null}
								onClick={() => onTabSelect(tab.id)}
								onMouseDown={(e) => {
									if (e.button === 1) {
										e.preventDefault();
										onTabClose(tab.id);
									}
								}}
								className="flex min-w-0 flex-1 items-center gap-1.5 self-stretch px-3 text-left outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring/50"
							>
								{getTabIcon(tab)}
								<span className="min-w-0 flex-1 truncate">{tab.title}</span>
							</button>
							<button
								type="button"
								onClick={() => onTabClose(tab.id)}
								aria-label={`Close ${tab.title}`}
								className={cn(
									"mr-1 flex size-6 shrink-0 items-center justify-center rounded-md outline-none transition-[background-color,opacity] hover:bg-muted focus-visible:ring-2 focus-visible:ring-ring/50",
									isActive
										? "opacity-100"
										: "opacity-0 group-hover:opacity-100 group-focus-within:opacity-100",
								)}
							>
								<X className="size-3" />
							</button>
						</div>
					);
				})}
			</div>
			<div className="flex shrink-0 items-center border-l border-border/70 px-1">
				<Button
					variant="ghost"
					size="icon-sm"
					onClick={onNewQuery}
					className="size-7"
					title="New query"
					aria-label="New query"
				>
					<Plus className="size-3.5" />
				</Button>
			</div>
		</div>
	);
}
