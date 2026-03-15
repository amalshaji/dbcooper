import { useMemo, useState, type ReactNode } from "react";
import { Badge } from "@/components/ui/badge";
import {
	Collapsible,
	CollapsibleContent,
	CollapsibleTrigger,
} from "@/components/ui/collapsible";
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
import { Input } from "@/components/ui/input";
import {
	Select,
	SelectContent,
	SelectGroup,
	SelectItem,
	SelectTrigger,
	SelectValue,
} from "@/components/ui/select";
import {
	SidebarGroup,
	SidebarGroupContent,
	SidebarGroupLabel,
	SidebarMenu,
	SidebarMenuButton,
	SidebarMenuItem,
	SidebarMenuSub,
	SidebarMenuSubButton,
	SidebarMenuSubItem,
} from "@/components/ui/sidebar";
import { Spinner } from "@/components/ui/spinner";
import type {
	FunctionSummary,
	QueryTab,
	SchemaOverview,
	TableColumn,
} from "@/types/tabTypes";
import { formatFunctionSignature } from "@/types/tabTypes";
import type { DatabaseTable } from "@/types/table";
import {
	CaretRight,
	Code,
	Columns,
	DotsThreeVertical,
	MagnifyingGlass,
	Table,
} from "@phosphor-icons/react";

interface ObjectExplorerProps {
	schemaOverview: SchemaOverview | null;
	loading: boolean;
	expandedTables: Set<string>;
	tableColumns: Record<string, TableColumn[]>;
	onToggleTableExpand: (tableName: string) => void;
	onOpenTableData: (tableName: string) => void;
	onRunQueryForTable: (tableName: string) => void;
	onOpenTableStructure: (tableName: string) => void;
	onOpenFunctionDefinition: (functionSummary: FunctionSummary) => void;
	activeQueryTab: QueryTab | null;
	onInsertQueryText: (text: string) => void;
}

interface SchemaObjects {
	tables: DatabaseTable[];
	views: DatabaseTable[];
	functions: FunctionSummary[];
}

const EMPTY_SCHEMA_OBJECTS: SchemaObjects = {
	tables: [],
	views: [],
	functions: [],
};

interface TableObjectRowProps {
	table: DatabaseTable;
	expandedTables: Set<string>;
	loading: boolean;
	tableColumns: Record<string, TableColumn[]>;
	activeQueryTab: QueryTab | null;
	onToggleTableExpand: (tableName: string) => void;
	onOpenTableData: (tableName: string) => void;
	onRunQueryForTable: (tableName: string) => void;
	onOpenTableStructure: (tableName: string) => void;
	onInsertQueryText: (text: string) => void;
}

function TableObjectRow({
	table,
	expandedTables,
	loading,
	tableColumns,
	activeQueryTab,
	onToggleTableExpand,
	onOpenTableData,
	onRunQueryForTable,
	onOpenTableStructure,
	onInsertQueryText,
}: TableObjectRowProps) {
	const tableName = `${table.schema}.${table.name}`;
	const isExpanded = expandedTables.has(tableName);
	const isLoading = loading && isExpanded && !tableColumns[tableName];
	const columns = tableColumns[tableName] || [];

	return (
		<ContextMenu key={tableName}>
			<ContextMenuTrigger>
				<Collapsible open={isExpanded}>
					<SidebarMenuItem>
						<SidebarMenuButton
							className="w-full gap-2 pr-8 group-hover/menu-item:bg-sidebar-accent group-hover/menu-item:text-sidebar-accent-foreground"
							onClick={() => {
								onOpenTableData(tableName);
							}}
						>
							<CollapsibleTrigger
								onClick={(event) => {
									event.stopPropagation();
									onToggleTableExpand(tableName);
								}}
								className="flex size-3 items-center justify-center rounded p-0 hover:bg-sidebar-accent hover:text-sidebar-accent-foreground"
							>
								<CaretRight
									className={`!h-3 !w-3 shrink-0 transition-transform ${
										isExpanded ? "rotate-90" : ""
									}`}
								/>
							</CollapsibleTrigger>
							<Table className="h-3 w-3" />
							<span className="truncate text-xs">{table.name}</span>
							{table.type === "view" && (
								<Badge
									variant="outline"
									className="ml-auto h-5 border-current/30 bg-transparent px-1.5 py-0 text-[10px] font-normal text-inherit shadow-none"
								>
									View
								</Badge>
							)}
						</SidebarMenuButton>
						<DropdownMenu>
							<DropdownMenuTrigger
								render={
									<button
										type="button"
										className="absolute right-1 top-1/2 -translate-y-1/2 rounded p-1 opacity-0 group-hover/menu-item:opacity-100 hover:bg-sidebar-accent hover:text-sidebar-accent-foreground"
										onClick={(event) => event.stopPropagation()}
									/>
								}
							>
								<DotsThreeVertical className="h-3 w-3" />
							</DropdownMenuTrigger>
							<DropdownMenuContent align="end">
								<DropdownMenuItem
									onClick={() => {
										onOpenTableData(tableName);
									}}
								>
									<Table className="h-4 w-4" />
									View Data
								</DropdownMenuItem>
								<DropdownMenuItem
									onClick={() => {
										onRunQueryForTable(tableName);
									}}
								>
									<Code className="h-4 w-4" />
									Run Query
								</DropdownMenuItem>
								<DropdownMenuItem
									onClick={() => {
										onOpenTableStructure(tableName);
									}}
								>
									<Columns className="h-4 w-4" />
									View Structure
								</DropdownMenuItem>
							</DropdownMenuContent>
						</DropdownMenu>
					</SidebarMenuItem>
					<CollapsibleContent>
						<SidebarMenuSub>
							{isLoading ? (
								<SidebarMenuSubItem>
									<SidebarMenuSubButton>
										<Spinner className="h-3 w-3" />
										<span className="text-muted-foreground">Loading...</span>
									</SidebarMenuSubButton>
								</SidebarMenuSubItem>
							) : columns.length > 0 ? (
								columns.map((column) => (
									<SidebarMenuSubItem key={column.name}>
										<SidebarMenuSubButton
											className="group/col-item"
											onClick={() => {
												if (activeQueryTab) {
													onInsertQueryText(column.name);
												}
											}}
										>
											<span className="truncate font-mono text-xs">
												{column.name}
											</span>
											<span className="ml-auto max-w-[80px] truncate text-xs text-muted-foreground group-hover/col-item:text-sidebar-accent-foreground">
												{column.type}
											</span>
											{column.primary_key && (
												<Badge
													variant="outline"
													className="ml-1 px-1 py-0 text-[10px]"
												>
													PK
												</Badge>
											)}
										</SidebarMenuSubButton>
									</SidebarMenuSubItem>
								))
							) : (
								<SidebarMenuSubItem>
									<SidebarMenuSubButton>
										<span className="text-xs text-muted-foreground">
											No columns
										</span>
									</SidebarMenuSubButton>
								</SidebarMenuSubItem>
							)}
						</SidebarMenuSub>
					</CollapsibleContent>
				</Collapsible>
			</ContextMenuTrigger>
			<ContextMenuContent>
				<ContextMenuItem
					onClick={() => {
						onOpenTableData(tableName);
					}}
				>
					<Table className="h-4 w-4" />
					View Data
				</ContextMenuItem>
				<ContextMenuItem
					onClick={() => {
						onRunQueryForTable(tableName);
					}}
				>
					<Code className="h-4 w-4" />
					Run Query
				</ContextMenuItem>
				<ContextMenuItem
					onClick={() => {
						onOpenTableStructure(tableName);
					}}
				>
					<Columns className="h-4 w-4" />
					View Structure
				</ContextMenuItem>
			</ContextMenuContent>
		</ContextMenu>
	);
}

function buildSchemaObjects(
	tables: DatabaseTable[],
	functions: FunctionSummary[],
): Array<[string, SchemaObjects]> {
	const groups: Record<string, SchemaObjects> = {};

	for (const table of tables) {
		if (!groups[table.schema]) {
			groups[table.schema] = { tables: [], views: [], functions: [] };
		}

		if (table.type === "view") {
			groups[table.schema].views.push(table);
		} else {
			groups[table.schema].tables.push(table);
		}
	}

	for (const functionSummary of functions) {
		if (!groups[functionSummary.schema]) {
			groups[functionSummary.schema] = { tables: [], views: [], functions: [] };
		}

		groups[functionSummary.schema].functions.push(functionSummary);
	}

	const entries = Object.entries(groups).sort(([left], [right]) =>
		left.localeCompare(right),
	);

	for (const [, objects] of entries) {
		objects.tables.sort((left, right) => left.name.localeCompare(right.name));
		objects.views.sort((left, right) => left.name.localeCompare(right.name));
		objects.functions.sort((left, right) =>
			formatFunctionSignature(left).localeCompare(formatFunctionSignature(right)),
		);
	}

	return entries;
}

function filterSchemaObjects(
	schema: string,
	objects: SchemaObjects,
	searchQuery: string,
): SchemaObjects {
	const query = searchQuery.trim().toLowerCase();

	if (!query || schema.toLowerCase().includes(query)) {
		return objects;
	}

	return {
		tables: objects.tables.filter((table) => {
			const fullName = `${table.schema}.${table.name}`.toLowerCase();
			return table.name.toLowerCase().includes(query) || fullName.includes(query);
		}),
		views: objects.views.filter((view) => {
			const fullName = `${view.schema}.${view.name}`.toLowerCase();
			return view.name.toLowerCase().includes(query) || fullName.includes(query);
		}),
		functions: objects.functions.filter((functionSummary) => {
			const signature = formatFunctionSignature(functionSummary)
				.toLowerCase()
				.replace(/\s+/g, " ");
			return (
				functionSummary.name.toLowerCase().includes(query) ||
				functionSummary.arguments.toLowerCase().includes(query) ||
				functionSummary.return_type.toLowerCase().includes(query) ||
				signature.includes(query)
			);
		}),
	};
}

function getObjectCount(objects: SchemaObjects): number {
	return objects.tables.length + objects.views.length + objects.functions.length;
}

interface SchemaSectionProps {
	label: string;
	children: ReactNode;
}

function SchemaSection({ label, children }: SchemaSectionProps) {
	return (
		<div>
			<SidebarGroupLabel className="h-5 px-2 text-[10px] font-semibold uppercase tracking-[0.12em] text-sidebar-foreground/45">
				{label}
			</SidebarGroupLabel>
			<SidebarMenu>{children}</SidebarMenu>
		</div>
	);
}

export function ObjectExplorer({
	schemaOverview,
	loading,
	expandedTables,
	tableColumns,
	onToggleTableExpand,
	onOpenTableData,
	onRunQueryForTable,
	onOpenTableStructure,
	onOpenFunctionDefinition,
	activeQueryTab,
	onInsertQueryText,
}: ObjectExplorerProps) {
	const [searchQuery, setSearchQuery] = useState("");
	const [selectedSchemaPreference, setSelectedSchemaPreference] = useState("");

	const tables = useMemo<DatabaseTable[]>(() => {
		if (!schemaOverview) {
			return [];
		}

		return schemaOverview.tables.map((table) => ({
			schema: table.schema,
			name: table.name,
			type: table.type === "view" ? "view" : "table",
		}));
	}, [schemaOverview]);

	const groupedSchemas = useMemo(
		() => buildSchemaObjects(tables, schemaOverview?.functions || []),
		[tables, schemaOverview],
	);
	const schemaEntries = useMemo(
		() =>
			groupedSchemas.map(([schema, objects]) => ({
				schema,
				objects,
				objectCount: getObjectCount(objects),
			})),
		[groupedSchemas],
	);
	const selectedSchema =
		schemaEntries.find((entry) => entry.schema === selectedSchemaPreference)
			?.schema ||
		schemaEntries.find((entry) => entry.schema === "public")?.schema ||
		schemaEntries[0]?.schema ||
		"";
	const selectedSchemaEntry = schemaEntries.find(
		(entry) => entry.schema === selectedSchema,
	);
	const selectedSchemaObjects = useMemo(
		() =>
			selectedSchemaEntry
				? filterSchemaObjects(
						selectedSchemaEntry.schema,
						selectedSchemaEntry.objects,
						searchQuery,
					)
				: EMPTY_SCHEMA_OBJECTS,
		[selectedSchemaEntry, searchQuery],
	);

	const totalObjectCount =
		tables.length + (schemaOverview?.functions.length || 0);
	const selectedSchemaTotal = selectedSchemaEntry?.objectCount || 0;
	const filteredObjectCount = getObjectCount(selectedSchemaObjects);

	return (
		<div className="flex h-full min-h-0 flex-col">
			<div className="space-y-2 px-2 pb-2">
				<div className="relative">
					<MagnifyingGlass className="absolute left-2 top-1/2 h-3 w-3 -translate-y-1/2 text-muted-foreground" />
					<Input
						placeholder="Search objects..."
						value={searchQuery}
						onChange={(event) => setSearchQuery(event.target.value)}
						className="h-7 pl-7 text-xs"
					/>
				</div>
				<div className="text-xs text-muted-foreground">
					{searchQuery
						? `${filteredObjectCount} of ${selectedSchemaTotal} objects`
						: selectedSchemaEntry
							? `${selectedSchemaTotal} objects`
							: `${totalObjectCount} objects`}
				</div>
			</div>

			<div className="min-h-0 flex-1 overflow-auto px-1">
				{schemaEntries.length === 0 ? (
					<div className="px-2 py-4 text-xs text-muted-foreground">
						No objects found.
					</div>
				) : filteredObjectCount === 0 ? (
					<div className="px-2 py-4 text-xs text-muted-foreground">
						No objects found in this schema.
					</div>
				) : (
						<SidebarGroup className="p-0">
							<SidebarGroupContent className="pb-2">
							<div className="space-y-2">
								{selectedSchemaObjects.tables.length > 0 && (
									<SchemaSection label="Tables">
										{selectedSchemaObjects.tables.map((table) => (
											<TableObjectRow
												key={`${table.schema}.${table.name}`}
												table={table}
												expandedTables={expandedTables}
												loading={loading}
												tableColumns={tableColumns}
												activeQueryTab={activeQueryTab}
												onToggleTableExpand={onToggleTableExpand}
												onOpenTableData={onOpenTableData}
												onRunQueryForTable={onRunQueryForTable}
												onOpenTableStructure={onOpenTableStructure}
												onInsertQueryText={onInsertQueryText}
											/>
										))}
									</SchemaSection>
								)}

								{selectedSchemaObjects.views.length > 0 && (
									<SchemaSection label="Views">
										{selectedSchemaObjects.views.map((table) => (
											<TableObjectRow
												key={`${table.schema}.${table.name}`}
												table={table}
												expandedTables={expandedTables}
												loading={loading}
												tableColumns={tableColumns}
												activeQueryTab={activeQueryTab}
												onToggleTableExpand={onToggleTableExpand}
												onOpenTableData={onOpenTableData}
												onRunQueryForTable={onRunQueryForTable}
												onOpenTableStructure={onOpenTableStructure}
												onInsertQueryText={onInsertQueryText}
											/>
										))}
									</SchemaSection>
								)}

								{selectedSchemaObjects.functions.length > 0 && (
									<SchemaSection label="Functions">
										{selectedSchemaObjects.functions.map((functionSummary) => (
											<SidebarMenuItem
												key={formatFunctionSignature(functionSummary)}
											>
												<SidebarMenuButton
													size="sm"
													onClick={() => {
														onOpenFunctionDefinition(functionSummary);
													}}
												>
													<Code className="!h-3 !w-3 shrink-0" />
													<span className="truncate text-xs">
														{formatFunctionSignature(functionSummary, false)}
													</span>
													<Badge
														variant="outline"
														className="ml-auto h-5 max-w-[88px] truncate border-current/30 bg-transparent px-1.5 py-0 text-[10px] font-normal text-inherit shadow-none"
													>
														{functionSummary.return_type}
													</Badge>
												</SidebarMenuButton>
											</SidebarMenuItem>
										))}
									</SchemaSection>
								)}
							</div>
						</SidebarGroupContent>
					</SidebarGroup>
				)}
			</div>

			{schemaEntries.length > 0 && (
					<div className="border-t px-2 pt-2">
					<div className="pb-1 text-[10px] font-semibold uppercase tracking-[0.12em] text-sidebar-foreground/45">
						Schema
					</div>
					<Select
						value={selectedSchema}
						onValueChange={setSelectedSchemaPreference}
					>
						<SelectTrigger size="sm" className="w-full justify-between">
							<SelectValue />
						</SelectTrigger>
						<SelectContent>
							<SelectGroup>
								{schemaEntries.map((entry) => (
									<SelectItem key={entry.schema} value={entry.schema}>
										<span className="truncate">{entry.schema}</span>
										<span className="ml-auto text-[10px] text-muted-foreground">
											{entry.objectCount}
										</span>
									</SelectItem>
								))}
							</SelectGroup>
						</SelectContent>
					</Select>
				</div>
			)}
		</div>
	);
}
