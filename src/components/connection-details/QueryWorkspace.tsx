import type React from "react";
import { format as formatSQL } from "sql-formatter";
import {
	CaretDown,
	Check,
	Copy,
	DownloadSimple,
	FloppyDisk,
	PaintBrush,
	PlayCircle,
} from "@phosphor-icons/react";
import type { ColumnDef } from "@tanstack/react-table";
import { toast } from "sonner";
import { DataTable } from "@/components/DataTable";
import { SqlEditor } from "@/components/SqlEditor";
import { Button } from "@/components/ui/button";
import {
	Card,
	CardContent,
	CardDescription,
	CardHeader,
	CardTitle,
} from "@/components/ui/card";
import {
	DropdownMenu,
	DropdownMenuContent,
	DropdownMenuItem,
	DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { Spinner } from "@/components/ui/spinner";
import { getSqlFormatterLanguage } from "@/lib/databaseCapabilities";
import type { Connection } from "@/lib/tauri";
import type { DatabaseTable } from "@/types/table";
import type { QueryTab, SortConfig, TableColumn } from "@/types/tabTypes";
interface QueryWorkspaceProps {
	tab: QueryTab;
	connection: Connection;
	tables: DatabaseTable[];
	tableColumns: Record<string, TableColumn[]>;
	queryColumns: ColumnDef<Record<string, unknown>>[];
	showSaveDialog: boolean;
	saveQueryName: string;
	setSaveQueryName: (value: string) => void;
	setShowSaveDialog: (value: boolean) => void;
	handleSaveQuery: () => void | Promise<void>;
	handleQueryChange: (query: string) => void;
	handleRunQuery: () => void | Promise<void>;
	handleRunAllQueries: () => void | Promise<void>;
	getEditorAiProps: (
		tab: QueryTab,
	) => React.ComponentProps<typeof SqlEditor>["ai"];
	setCursorLine: (line: number) => void;
	setCursorChar: (char: number) => void;
	handleCopyQueryError: (errorMessage: string) => void | Promise<void>;
	handleExportCSV: () => void | Promise<void>;
	handleQueryFilterInputChange: (value: string) => void;
	handleApplyQueryFilter: () => void;
	handleClearFilter: () => void;
	handleQuerySortChange: (sort: SortConfig | null) => void;
	setSelectedQueryRow: React.Dispatch<
		React.SetStateAction<{
			row: Record<string, unknown>;
			index: number;
		} | null>
	>;
	setQueryResultSheetOpen: React.Dispatch<React.SetStateAction<boolean>>;
}

function formatQuerySuccessDetail(affectedRows: number | null): string {
	if (affectedRows === null) return "No rows returned";

	return `${affectedRows} row${affectedRows !== 1 ? "s" : ""} affected`;
}

export function QueryWorkspace({
	tab,
	connection,
	tables,
	tableColumns,
	queryColumns,
	showSaveDialog,
	saveQueryName,
	setSaveQueryName,
	setShowSaveDialog,
	handleSaveQuery,
	handleQueryChange,
	handleRunQuery,
	handleRunAllQueries,
	getEditorAiProps,
	setCursorLine,
	setCursorChar,
	handleCopyQueryError,
	handleExportCSV,
	handleQueryFilterInputChange,
	handleApplyQueryFilter,
	handleClearFilter,
	handleQuerySortChange,
	setSelectedQueryRow,
	setQueryResultSheetOpen,
}: QueryWorkspaceProps) {
	const renderQueryError = (errorMessage: string) => {
		const trimmedError = errorMessage.trimEnd();

		return (
			<div className="rounded-md border border-destructive/20 bg-destructive/10 p-4">
				<div className="flex items-start justify-between">
					<p className="text-sm font-medium text-destructive">Query error</p>
					<Button
						variant="ghost"
						size="sm"
						className="h-7 px-2 text-destructive hover:text-destructive"
						onClick={() => handleCopyQueryError(trimmedError)}
					>
						<Copy className="w-4 h-4" />
						Copy
					</Button>
				</div>
				<div className="mt-1">
					<span className="inline whitespace-pre-wrap break-words select-text text-sm text-destructive/80">
						{trimmedError}
					</span>
				</div>
			</div>
		);
	};

	const renderQueryContent = (tab: QueryTab) => (
		<div className="space-y-3">
			<Card className="workspace-panel gap-2">
				<CardHeader>
					<div className="flex items-center justify-between">
						<div>
							<CardTitle>SQL editor</CardTitle>
							<CardDescription>Write and execute SQL queries</CardDescription>
						</div>
						<div className="flex items-center gap-2">
							{showSaveDialog ? (
								<div className="flex items-center gap-2">
									<Input
										placeholder="Query name"
										value={saveQueryName}
										onChange={(e) => setSaveQueryName(e.target.value)}
										className="w-40"
										onKeyDown={(e) => {
											if (e.key === "Enter") {
												handleSaveQuery();
											} else if (e.key === "Escape") {
												setShowSaveDialog(false);
												setSaveQueryName("");
											}
										}}
										autoFocus
									/>
									<Button
										size="sm"
										onClick={handleSaveQuery}
										disabled={!saveQueryName.trim()}
									>
										Save
									</Button>
									<Button
										size="sm"
										variant="ghost"
										onClick={() => {
											setShowSaveDialog(false);
											setSaveQueryName("");
										}}
									>
										Cancel
									</Button>
								</div>
							) : (
								<>
									<Button
										size="sm"
										variant="outline"
										onClick={() => {
											try {
												const formatted = formatSQL(tab.query, {
													language: getSqlFormatterLanguage(
														connection?.db_type || "postgres",
													),
													tabWidth: 2,
													keywordCase: "upper",
												});
												handleQueryChange(formatted);
												toast.success("SQL formatted");
											} catch (error) {
												toast.error("Failed to format SQL", {
													description:
														error instanceof Error
															? error.message
															: "Unknown error",
												});
											}
										}}
										disabled={!tab.query.trim()}
									>
										<PaintBrush className="w-4 h-4" />
										Beautify
									</Button>
									<Button
										size="sm"
										variant="outline"
										onClick={() => {
											// Pre-populate name if this is an existing saved query
											if (tab.savedQueryName) {
												setSaveQueryName(tab.savedQueryName);
											}
											setShowSaveDialog(true);
										}}
										disabled={!tab.query.trim()}
									>
										<FloppyDisk className="w-4 h-4" />
										Save query
									</Button>
									<div className="flex">
										<Button
											size="sm"
											onClick={handleRunQuery}
											disabled={tab.executing}
											className="rounded-r-none border-r-0 -mr-1"
										>
											{tab.executing ? <Spinner /> : null}
											Run query{" "}
											<span className="text-xs opacity-60">
												({navigator.platform.includes("Mac") ? "⌘" : "Ctrl"}
												+↵)
											</span>
										</Button>
										<DropdownMenu>
											<DropdownMenuTrigger
												render={
													<Button
														size="sm"
														className="px-1 rounded-l-none border border-border"
														disabled={tab.executing}
													>
														<CaretDown className="w-4 h-4" />
													</Button>
												}
											/>
											<DropdownMenuContent align="end">
												<DropdownMenuItem onClick={handleRunAllQueries}>
													<PlayCircle className="w-4 h-4" />
													Run all queries
												</DropdownMenuItem>
											</DropdownMenuContent>
										</DropdownMenu>
									</div>
								</>
							)}
						</div>
					</div>
				</CardHeader>
				<CardContent>
					<SqlEditor
						value={tab.query}
						onChange={handleQueryChange}
						onRunQuery={handleRunQuery}
						height="300px"
						// disabled={!tab.query.trim()}
						tables={tables.map((t) => ({
							schema: t.schema,
							name: t.name,
							columns: tableColumns[`${t.schema}.${t.name}`],
						}))}
						ai={getEditorAiProps(tab)}
						onCursorActivity={(line, char) => {
							setCursorLine(line);
							setCursorChar(char);
						}}
					/>
				</CardContent>
			</Card>

			<Card className="workspace-panel">
				<CardHeader>
					<div className="flex items-center justify-between">
						<div>
							<div className="flex items-center gap-2">
								<CardTitle>Query results</CardTitle>
								{tab.executionTime !== null && (
									<span className="text-xs text-muted-foreground">
										({tab.executionTime}ms)
									</span>
								)}
							</div>
							<CardDescription>
								{tab.results !== null &&
									tab.results.length > 0 &&
									`${tab.filter ? "Filtered " : ""}returned ${
										tab.results.length
									} row${tab.results.length !== 1 ? "s" : ""}`}
								{tab.results !== null &&
									tab.results.length === 0 &&
									tab.success &&
									(tab.affectedRows !== null
										? `Query executed successfully - ${formatQuerySuccessDetail(
												tab.affectedRows,
											)}`
										: "Query executed successfully - no rows returned")}
							</CardDescription>
						</div>
						{tab.results && tab.results.length > 0 && (
							<Button variant="outline" size="sm" onClick={handleExportCSV}>
								<DownloadSimple className="w-4 h-4" />
								Download CSV
							</Button>
						)}
					</div>
				</CardHeader>
				<CardContent>
					{tab.executing ? (
						<div className="space-y-3">
							<div className="flex items-center gap-2">
								{[...Array(4)].map((_, i) => (
									<Skeleton key={i} className="h-8 flex-1 rounded" />
								))}
							</div>
							{[...Array(5)].map((_, rowIndex) => (
								<div key={rowIndex} className="flex items-center gap-2">
									{[...Array(4)].map((_, colIndex) => (
										<Skeleton key={colIndex} className="h-6 flex-1 rounded" />
									))}
								</div>
							))}
						</div>
					) : tab.error ? (
						renderQueryError(tab.error)
					) : tab.results ? (
						<div className="space-y-4">
							{tab.resultBaseQuery ? (
								<div className="flex items-center gap-2">
									<Input
										placeholder="Filter query output (SQL WHERE clause)"
										value={tab.filterInput}
										onChange={(e: React.ChangeEvent<HTMLInputElement>) =>
											handleQueryFilterInputChange(e.target.value)
										}
										onKeyDown={(e: React.KeyboardEvent<HTMLInputElement>) => {
											if (e.key === "Enter") {
												handleApplyQueryFilter();
											}
										}}
										className="flex-1 font-mono text-xs"
									/>
									{tab.filter && (
										<Button
											size="sm"
											variant="outline"
											onClick={handleClearFilter}
											disabled={tab.executing}
										>
											Clear
										</Button>
									)}
								</div>
							) : (
								<div className="text-xs text-muted-foreground">
									Query-level filter/sort is only available for SELECT-style
									results.
								</div>
							)}
							{tab.filter && (
								<div className="text-xs text-muted-foreground">
									Active filter:{" "}
									<code className="bg-muted px-1 py-0.5 rounded">
										{tab.filter}
									</code>
								</div>
							)}
							{tab.results.length > 0 ? (
								<div className="max-h-[85vh]">
									<DataTable
										data={tab.results}
										columns={queryColumns}
										hidePagination
										virtualize={tab.results.length > 100}
										sortable={!!tab.resultBaseQuery}
										sort={tab.sort}
										onSortChange={
											tab.resultBaseQuery ? handleQuerySortChange : undefined
										}
										onRowClick={(row) => {
											const index = tab.results?.indexOf(row) ?? -1;
											setSelectedQueryRow({ row, index });
											setQueryResultSheetOpen(true);
										}}
									/>
								</div>
							) : tab.success ? (
								<div className="flex items-start gap-2 rounded-md border bg-muted/20 px-3 py-2 text-sm">
									<span className="mt-0.5 flex h-4 w-4 shrink-0 items-center justify-center rounded-[3px] border border-green-500 bg-green-50 text-green-600 dark:border-green-500/80 dark:bg-green-950/30 dark:text-green-400">
										<Check weight="bold" className="h-3 w-3" />
									</span>
									<div className="min-w-0">
										<p className="font-medium text-foreground">
											Query executed successfully
										</p>
										<p className="mt-0.5 text-muted-foreground">
											{formatQuerySuccessDetail(tab.affectedRows)}
										</p>
									</div>
								</div>
							) : null}
						</div>
					) : (
						<div className="flex min-h-40 items-center justify-center px-4 text-center">
							<p className="max-w-md text-sm text-muted-foreground">
								No results yet. Write a SQL query, then run it to see the output
								here.
							</p>
						</div>
					)}
				</CardContent>
			</Card>
		</div>
	);

	return renderQueryContent(tab);
}
