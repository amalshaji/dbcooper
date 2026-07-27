import { useCallback, useEffect } from "react";
import type { Connection } from "@/lib/tauri";
import type { Tab } from "@/types/tabTypes";

interface UseConnectionShortcutsOptions {
	activeTab: Tab | null;
	tabsLength: number;
	connection: Connection | null;
	setSidebarTab: (tab: "objects" | "queries" | "history") => void;
	navigate: (path: string) => void;
	handleNewQuery: () => void;
	handleNextTab: () => void;
	handlePreviousTab: () => void;
	handleSaveQuery: () => void;
	handleRunQuery: () => void;
	handleRefreshTableData: () => void;
	handleExportCSV: () => void;
	handleClearFilter: () => void;
	handleOpenSchemaVisualizer: () => void;
}

export function useConnectionShortcuts({
	activeTab,
	tabsLength,
	connection,
	setSidebarTab,
	navigate,
	handleNewQuery,
	handleNextTab,
	handlePreviousTab,
	handleSaveQuery,
	handleRunQuery,
	handleRefreshTableData,
	handleExportCSV,
	handleClearFilter,
	handleOpenSchemaVisualizer,
}: UseConnectionShortcutsOptions) {
	const handleToggleSidebar = useCallback(() => {
		const sidebarTrigger = document.querySelector(
			'[data-slot="sidebar-trigger"]',
		) as HTMLElement;
		sidebarTrigger?.click();
	}, []);

	useEffect(() => {
		const handleKeyDown = (event: KeyboardEvent) => {
			const target = event.target as HTMLElement;
			if (
				target.tagName === "INPUT" ||
				target.tagName === "TEXTAREA" ||
				target.closest(".cm-editor")
			) {
				return;
			}

			if (event.key === "k" && (event.metaKey || event.ctrlKey)) return;

			if (event.key === "n" && (event.metaKey || event.ctrlKey)) {
				event.preventDefault();
				handleNewQuery();
				return;
			}

			if (
				event.key === "]" &&
				(event.metaKey || event.ctrlKey) &&
				tabsLength > 1
			) {
				event.preventDefault();
				handleNextTab();
				return;
			}

			if (
				event.key === "[" &&
				(event.metaKey || event.ctrlKey) &&
				tabsLength > 1
			) {
				event.preventDefault();
				handlePreviousTab();
				return;
			}

			if (event.key === "b" && (event.metaKey || event.ctrlKey)) {
				event.preventDefault();
				handleToggleSidebar();
				return;
			}

			if (
				event.key === "s" &&
				(event.metaKey || event.ctrlKey) &&
				activeTab?.type === "query"
			) {
				event.preventDefault();
				handleSaveQuery();
				return;
			}

			if (
				event.key === "r" &&
				(event.metaKey || event.ctrlKey) &&
				(activeTab?.type === "query" || activeTab?.type === "table-data")
			) {
				event.preventDefault();
				if (activeTab.type === "query") handleRunQuery();
				else handleRefreshTableData();
				return;
			}

			if (
				event.key === "e" &&
				(event.metaKey || event.ctrlKey) &&
				activeTab?.type === "query" &&
				activeTab.results?.length
			) {
				event.preventDefault();
				handleExportCSV();
				return;
			}

			if (
				event.key === "x" &&
				(event.metaKey || event.ctrlKey) &&
				event.shiftKey &&
				((activeTab?.type === "table-data" && activeTab.filterState.applied) ||
					(activeTab?.type === "query" && activeTab.filter))
			) {
				event.preventDefault();
				handleClearFilter();
				return;
			}

			if (
				event.key === "v" &&
				(event.metaKey || event.ctrlKey) &&
				event.shiftKey &&
				connection?.type !== "redis" &&
				connection?.db_type !== "clickhouse"
			) {
				event.preventDefault();
				handleOpenSchemaVisualizer();
				return;
			}

			if (
				event.key === "1" &&
				(event.metaKey || event.ctrlKey) &&
				connection?.type !== "redis"
			) {
				event.preventDefault();
				setSidebarTab("objects");
				return;
			}

			if (
				event.key === "2" &&
				(event.metaKey || event.ctrlKey) &&
				connection?.type !== "redis"
			) {
				event.preventDefault();
				setSidebarTab("queries");
				return;
			}

			if (event.key === "Backspace" && (event.metaKey || event.ctrlKey)) {
				event.preventDefault();
				navigate("/");
			}
		};

		document.addEventListener("keydown", handleKeyDown);
		return () => document.removeEventListener("keydown", handleKeyDown);
	}, [
		activeTab,
		connection,
		handleClearFilter,
		handleExportCSV,
		handleNewQuery,
		handleNextTab,
		handleOpenSchemaVisualizer,
		handlePreviousTab,
		handleRefreshTableData,
		handleRunQuery,
		handleSaveQuery,
		handleToggleSidebar,
		navigate,
		setSidebarTab,
		tabsLength,
	]);

	return { handleToggleSidebar };
}
