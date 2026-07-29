import { useMemo, useState } from "react";
import type React from "react";
import { format as formatSQL } from "sql-formatter";
import {
	Check,
	Copy,
	DownloadSimple,
	FloppyDisk,
	PaintBrush,
} from "@phosphor-icons/react";
import type { ColumnDef } from "@tanstack/react-table";
import { toast } from "sonner";
import { DataTable } from "@/components/DataTable";
import { QueryResultSheet } from "@/components/QueryResultSheet";
import { SqlEditor } from "@/components/SqlEditor";
import { Button } from "@/components/ui/button";
import {
	Card,
	CardContent,
	CardDescription,
	CardHeader,
	CardTitle,
} from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { getSqlFormatterLanguage } from "@/lib/databaseCapabilities";
import type { SqlConnection } from "@/types/connection";
import type { DatabaseTable } from "@/types/table";
import type { QueryTab, TableColumn } from "@/types/tabTypes";
import type { QueryWorkspaceController } from "@/hooks/connection-details/useQueryWorkspaceController";
interface QueryWorkspaceProps {
	tab: QueryTab;
	connection: SqlConnection;
	tables: DatabaseTable[];
	tableColumns: Record<string, TableColumn[]>;
	controller: QueryWorkspaceController;
	getEditorAiProps: (
		tab: QueryTab,
	) => React.ComponentProps<typeof SqlEditor>["ai"];
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
	controller,
	getEditorAiProps,
}: QueryWorkspaceProps) {
	const [queryResultSheetOpen, setQueryResultSheetOpen] = useState(false);
	const [selectedQueryRow, setSelectedQueryRow] = useState<{
		row: Record<string, unknown>;
		index: number;
	} | null>(null);
	const reviewing = tab.ai.draft.status !== "idle";
	const queryColumns = useMemo<ColumnDef<Record<string, unknown>>[]>(() => {
		if (!tab.results?.length) return [];

		return Object.keys(tab.results[0]).map((key) => ({
			accessorKey: key,
			header: key,
			cell: ({ getValue }) => {
				const value = getValue();
				if (value === null) {
					return <span className="text-muted-foreground italic">null</span>;
				}
				const rawValue =
					typeof value === "object" ? JSON.stringify(value) : String(value);
				const displayValue =
					rawValue.length > 200 ? `${rawValue.slice(0, 200)}…` : rawValue;
				return <span title={rawValue}>{displayValue}</span>;
			},
		}));
	}, [tab.results]);
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
						onClick={() => controller.copyQueryError(trimmedError)}
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
	const queryToolbarActions = controller.saveDialog.open ? (
		<div className="flex items-center gap-2">
			<Input
				placeholder="Query name"
				value={controller.saveDialog.name}
				onChange={(e) => controller.changeSaveQueryName(e.target.value)}
				className="h-8 w-40"
				disabled={reviewing}
				onKeyDown={(e) => {
					if (e.key === "Enter") {
						controller.saveQuery();
					} else if (e.key === "Escape") {
						controller.closeSaveDialog();
					}
				}}
				autoFocus
			/>
			<Button
				size="sm"
				onClick={controller.saveQuery}
				disabled={reviewing || !controller.saveDialog.name.trim()}
			>
				Save
			</Button>
			<Button size="sm" variant="ghost" onClick={controller.closeSaveDialog}>
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
						controller.changeQuery(formatted);
						toast.success("SQL formatted");
					} catch (error) {
						toast.error("Failed to format SQL", {
							description:
								error instanceof Error ? error.message : "Unknown error",
						});
					}
				}}
				disabled={reviewing || !tab.query.trim()}
			>
				<PaintBrush className="w-4 h-4" />
				Beautify
			</Button>
			<Button
				size="sm"
				variant="outline"
				onClick={controller.openSaveDialog}
				disabled={reviewing || !tab.query.trim()}
			>
				<FloppyDisk className="w-4 h-4" />
				Save query
			</Button>
		</>
	);

	return (
		<div className="space-y-3">
			<Card className="workspace-panel gap-2">
				<CardHeader>
					<CardTitle>SQL editor</CardTitle>
					<CardDescription>Write and execute SQL queries</CardDescription>
				</CardHeader>
				<CardContent>
					<SqlEditor
						value={tab.query}
						onChange={controller.changeQuery}
						onRunQuery={controller.runQuery}
						onRunAllQueries={controller.runAllQueries}
						toolbarActions={queryToolbarActions}
						executing={tab.executing}
						height="300px"
						// disabled={!tab.query.trim()}
						tables={tables.map((t) => ({
							schema: t.schema,
							name: t.name,
							columns: tableColumns[`${t.schema}.${t.name}`],
						}))}
						ai={getEditorAiProps(tab)}
						onCursorActivity={controller.handleCursorActivity}
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
							<Button
								variant="outline"
								size="sm"
								onClick={controller.exportCsv}
							>
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
											controller.changeFilterInput(e.target.value)
										}
										onKeyDown={(e: React.KeyboardEvent<HTMLInputElement>) => {
											if (e.key === "Enter") {
												controller.applyFilter();
											}
										}}
										className="flex-1 font-mono text-xs"
									/>
									{tab.filter && (
										<Button
											size="sm"
											variant="outline"
											onClick={controller.clearFilter}
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
											tab.resultBaseQuery ? controller.changeSort : undefined
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
			<QueryResultSheet
				open={queryResultSheetOpen}
				onOpenChange={(open) => {
					setQueryResultSheetOpen(open);
					if (!open) setSelectedQueryRow(null);
				}}
				row={selectedQueryRow?.row || null}
				rowIndex={selectedQueryRow?.index}
			/>
		</div>
	);
}
