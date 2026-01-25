import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
	ReactFlow,
	ReactFlowProvider,
	Background,
	Controls,
	useNodesState,
	useEdgesState,
	addEdge,
	useReactFlow,
	MarkerType,
	type Connection,
	type Edge,
	type Node,
} from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import dagre from "dagre";
import { toSvg } from "html-to-image";
import { toast } from "sonner";
import { TableNode } from "./SchemaVisualizer/TableNode";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { Spinner } from "@/components/ui/spinner";
import {
	Sheet,
	SheetContent,
	SheetDescription,
	SheetHeader,
	SheetTitle,
	SheetTrigger,
} from "@/components/ui/sheet";
import {
	ArrowsClockwise,
	Funnel,
	MagnifyingGlass,
	DownloadSimple,
} from "@phosphor-icons/react";
import type { SchemaOverview, TableWithStructure } from "@/types/tabTypes";

const nodeTypes = { tableNode: TableNode };

interface SchemaVisualizerProps {
	schemaOverview: SchemaOverview | null;
	loading: boolean;
	onRefresh?: () => void;
	onTableClick?: (tableName: string) => void;
	tableFilter: string;
	onTableFilterChange: (filter: string) => void;
	selectedTables: string[];
	onSelectedTablesChange: (tables: string[]) => void;
}

function getLayoutedElements(
	tables: TableWithStructure[],
	showColumns: boolean,
): { nodes: Node[]; edges: Edge[] } {
	const nodes: Node[] = [];
	const edges: Edge[] = [];

	const tableMap = new Map<string, TableWithStructure>();
	tables.forEach((table) => {
		const fullName = `${table.schema}.${table.name}`;
		tableMap.set(fullName, table);
	});

	const referencedColumnsMap = new Map<string, Set<string>>();

	tables.forEach((table) => {
		const fullName = `${table.schema}.${table.name}`;
		table.foreign_keys.forEach((fk) => {
			const targetTable = `${table.schema}.${fk.references_table}`;
			if (!referencedColumnsMap.has(targetTable)) {
				referencedColumnsMap.set(targetTable, new Set());
			}
			referencedColumnsMap.get(targetTable)!.add(fk.references_column);
		});
	});

	tables.forEach((table) => {
		const fullName = `${table.schema}.${table.name}`;
		const nodeId = fullName;

		nodes.push({
			id: nodeId,
			type: "tableNode",
			position: { x: 0, y: 0 },
			data: {
				tableName: table.name,
				schema: table.schema,
				columns: table.columns,
				foreignKeys: table.foreign_keys,
				referencedColumns: referencedColumnsMap.get(nodeId) || new Set(),
				showColumns,
				onTableClick: (tableName: string) => {
					const event = new CustomEvent("table-click", {
						detail: { tableName },
					});
					window.dispatchEvent(event);
				},
			},
		});

		table.foreign_keys.forEach((fk) => {
			const targetTable = `${table.schema}.${fk.references_table}`;
			if (tableMap.has(targetTable)) {
				const edgeId = `${nodeId}-${targetTable}-${fk.column}`;
				const sourceHandle = showColumns ? `${fk.column}-source` : undefined;
				const targetHandle = showColumns
					? `${fk.references_column}-target`
					: undefined;

				edges.push({
					id: edgeId,
					source: nodeId,
					target: targetTable,
					sourceHandle,
					targetHandle,
					type: "smoothstep",
					animated: true,
					style: { stroke: "#f97316", strokeWidth: 2 },
					markerEnd: {
						type: MarkerType.ArrowClosed,
						color: "#f97316",
						width: 20,
						height: 20,
					},
				});
			}
		});
	});

	const HEADER_HEIGHT = 36;
	const ROW_HEIGHT = 36;
	const NODE_WIDTH = showColumns ? 280 : 180;
	const GRID_GAP_X = 30;
	const GRID_GAP_Y = 30;

	const connectedNodeIds = new Set<string>();
	edges.forEach((edge) => {
		connectedNodeIds.add(edge.source);
		connectedNodeIds.add(edge.target);
	});

	const connectedNodes = nodes.filter((n) => connectedNodeIds.has(n.id));
	const disconnectedNodes = nodes.filter((n) => !connectedNodeIds.has(n.id));

	if (connectedNodes.length > 0) {
		const dagreGraph = new dagre.graphlib.Graph();
		dagreGraph.setDefaultEdgeLabel(() => ({}));
		dagreGraph.setGraph({
			rankdir: "LR",
			nodesep: 30,
			ranksep: 80,
		});

		connectedNodes.forEach((node) => {
			const columnCount = tableMap.get(node.id)!.columns.length;
			const nodeHeight = showColumns
				? HEADER_HEIGHT + columnCount * ROW_HEIGHT
				: 60;
			dagreGraph.setNode(node.id, {
				width: NODE_WIDTH,
				height: nodeHeight,
			});
		});

		edges.forEach((edge) => {
			dagreGraph.setEdge(edge.source, edge.target);
		});

		dagre.layout(dagreGraph);

		connectedNodes.forEach((node) => {
			const nodeWithPosition = dagreGraph.node(node.id);
			const columnCount = tableMap.get(node.id)!.columns.length;
			const nodeHeight = showColumns
				? HEADER_HEIGHT + columnCount * ROW_HEIGHT
				: 60;
			node.position = {
				x: nodeWithPosition.x - NODE_WIDTH / 2,
				y: nodeWithPosition.y - nodeHeight / 2,
			};
		});
	}

	if (disconnectedNodes.length > 0) {
		let maxBottomY = 0;
		connectedNodes.forEach((node) => {
			const columnCount = tableMap.get(node.id)!.columns.length;
			const nodeHeight = showColumns
				? HEADER_HEIGHT + columnCount * ROW_HEIGHT
				: 60;
			const bottomY = node.position.y + nodeHeight;
			if (bottomY > maxBottomY) {
				maxBottomY = bottomY;
			}
		});

		const startY = connectedNodes.length > 0 ? maxBottomY + 80 : 0;
		const columns = Math.ceil(Math.sqrt(disconnectedNodes.length));
		const numRows = Math.ceil(disconnectedNodes.length / columns);

		const rowHeights: number[] = [];
		for (let row = 0; row < numRows; row++) {
			let maxHeight = 0;
			for (let col = 0; col < columns; col++) {
				const idx = row * columns + col;
				if (idx < disconnectedNodes.length) {
					const node = disconnectedNodes[idx];
					const columnCount = tableMap.get(node.id)!.columns.length;
					const nodeHeight = showColumns
						? HEADER_HEIGHT + columnCount * ROW_HEIGHT
						: 60;
					if (nodeHeight > maxHeight) maxHeight = nodeHeight;
				}
			}
			rowHeights.push(maxHeight);
		}

		disconnectedNodes.forEach((node, index) => {
			const col = index % columns;
			const row = Math.floor(index / columns);

			let yOffset = 0;
			for (let r = 0; r < row; r++) {
				yOffset += rowHeights[r] + GRID_GAP_Y;
			}

			node.position = {
				x: col * (NODE_WIDTH + GRID_GAP_X),
				y: startY + yOffset,
			};
		});
	}

	return { nodes, edges };
}

export function SchemaVisualizer({
	schemaOverview,
	loading,
	onRefresh,
	onTableClick,
	tableFilter,
	onTableFilterChange,
	selectedTables: selectedTablesArray,
	onSelectedTablesChange,
}: SchemaVisualizerProps) {
	const [showColumns, setShowColumns] = useState(true);
	const [filterOpen, setFilterOpen] = useState(false);
	const [downloadTrigger, setDownloadTrigger] = useState(0);
	const [isDownloading, setIsDownloading] = useState(false);
	const selectedTables = useMemo(
		() => new Set(selectedTablesArray),
		[selectedTablesArray],
	);
	const [hasInitialized, setHasInitialized] = useState(false);

	const handleDownload = useCallback(() => {
		setDownloadTrigger((prev) => prev + 1);
	}, []);

	const allTableNames = useMemo(() => {
		if (!schemaOverview) return [];
		return schemaOverview.tables.map((t) => `${t.schema}.${t.name}`);
	}, [schemaOverview]);

	useEffect(() => {
		if (schemaOverview && !hasInitialized && allTableNames.length > 0) {
			if (selectedTablesArray.length === 0) {
				onSelectedTablesChange(allTableNames);
			}
			setHasInitialized(true);
		}
	}, [
		schemaOverview,
		allTableNames,
		hasInitialized,
		selectedTablesArray.length,
		onSelectedTablesChange,
	]);

	const filteredTables = useMemo(() => {
		if (!schemaOverview) return [];
		return schemaOverview.tables.filter((table) => {
			const fullName = `${table.schema}.${table.name}`;
			return selectedTables.has(fullName);
		});
	}, [schemaOverview, selectedTables]);

	const toggleTable = useCallback(
		(tableName: string) => {
			const newSet = new Set(selectedTablesArray);
			if (newSet.has(tableName)) {
				newSet.delete(tableName);
			} else {
				newSet.add(tableName);
			}
			onSelectedTablesChange(Array.from(newSet));
		},
		[selectedTablesArray, onSelectedTablesChange],
	);

	const filteredTable = useMemo(
		() =>
			schemaOverview?.tables
				.filter((table) => {
					const fullName = `${table.schema}.${table.name}`;
					return (
						tableFilter === "" ||
						fullName.toLowerCase().includes(tableFilter.toLowerCase()) ||
						table.name.toLowerCase().includes(tableFilter.toLowerCase())
					);
				})
				.map((t) => `${t.schema}.${t.name}`),
		[schemaOverview, tableFilter],
	);

	const selectAll = useCallback(() => {
		if (tableFilter === "" || !filteredTable) {
			onSelectedTablesChange(allTableNames);
		} else {
			const combined = [...new Set([...selectedTablesArray, ...filteredTable])];
			onSelectedTablesChange(combined);
		}
	}, [
		tableFilter,
		filteredTable,
		selectedTablesArray,
		allTableNames,
		onSelectedTablesChange,
	]);

	const deselectAll = useCallback(() => {
		if (tableFilter === "" || !filteredTable) {
			onSelectedTablesChange([]);
		} else {
			const remaining = selectedTablesArray.filter(
				(t) => !filteredTable.includes(t),
			);
			onSelectedTablesChange(remaining);
		}
	}, [tableFilter, filteredTable, selectedTablesArray, onSelectedTablesChange]);

	const { nodes: initialNodes, edges: initialEdges } = useMemo(() => {
		if (!schemaOverview || filteredTables.length === 0) {
			return { nodes: [], edges: [] };
		}
		return getLayoutedElements(filteredTables, showColumns);
	}, [filteredTables, showColumns]);

	const [nodes, setNodes, onNodesChange] = useNodesState(initialNodes);
	const [edges, setEdges, onEdgesChange] = useEdgesState(initialEdges);

	useEffect(() => {
		const { nodes: newNodes, edges: newEdges } = getLayoutedElements(
			filteredTables,
			showColumns,
		);
		setNodes(newNodes);
		setEdges(newEdges);
	}, [filteredTables, showColumns, setNodes, setEdges]);

	const onConnect = useCallback(
		(params: Connection) => setEdges((eds) => addEdge(params, eds)),
		[setEdges],
	);

	useEffect(() => {
		const handleTableClick = ((e: CustomEvent<{ tableName: string }>) => {
			onTableClick?.(e.detail.tableName);
		}) as EventListener;

		window.addEventListener("table-click", handleTableClick);

		return () => {
			window.removeEventListener("table-click", handleTableClick);
		};
	}, [onTableClick]);

	if (loading) {
		return (
			<Card className="h-full flex flex-col">
				<CardHeader className="pb-3">
					<div className="flex items-center justify-between">
						<div className="flex flex-col gap-2">
							<CardTitle>Schema Visualizer</CardTitle>
							<div className="flex items-center gap-4 text-xs text-muted-foreground">
								<span className="font-medium">Legend:</span>
								<div className="flex items-center gap-1">
									<Badge
										variant="outline"
										className="text-[10px] px-1 py-0 bg-blue-500/10 text-blue-600 dark:text-blue-400 border-blue-500/20"
									>
										PK
									</Badge>
									<span>= Primary Key</span>
								</div>
								<div className="flex items-center gap-1">
									<Badge
										variant="outline"
										className="text-[10px] px-1 py-0 bg-orange-500/10 text-orange-600 dark:text-orange-400 border-orange-500/20"
									>
										FK
									</Badge>
									<span>= Foreign Key</span>
								</div>
								<div className="flex items-center gap-1">
									<span className="text-muted-foreground">?</span>
									<span>= Nullable</span>
								</div>
							</div>
						</div>
						<div className="flex items-center gap-2">
							<Skeleton className="h-9 w-32 rounded" />
							{onRefresh && <Skeleton className="h-9 w-24 rounded" />}
						</div>
					</div>
				</CardHeader>
				<CardContent className="flex-1 min-h-0">
					<div className="h-full w-full relative">
						<div className="absolute inset-0 flex items-center justify-center gap-4">
							{Array.from({ length: 6 }).map((_, i) => (
								<div key={i} className="flex flex-col gap-2">
									<Skeleton className="h-8 w-48 rounded" />
									<Skeleton className="h-32 w-48 rounded" />
								</div>
							))}
						</div>
					</div>
				</CardContent>
			</Card>
		);
	}

	if (!schemaOverview || schemaOverview.tables.length === 0) {
		return (
			<Card>
				<CardHeader>
					<CardTitle>Schema Visualizer</CardTitle>
				</CardHeader>
				<CardContent className="flex items-center justify-center py-12">
					<p className="text-muted-foreground">
						No tables found in this database.
					</p>
				</CardContent>
			</Card>
		);
	}

	if (filteredTables.length === 0 && selectedTables.size > 0) {
		return (
			<Card className="h-full flex flex-col">
				<CardHeader className="pb-3">
					<div className="flex items-center justify-between">
						<div className="flex flex-col gap-2">
							<CardTitle>Schema Visualizer</CardTitle>
							<div className="flex items-center gap-4 text-xs text-muted-foreground">
								<span className="font-medium">Legend:</span>
								<div className="flex items-center gap-1">
									<Badge
										variant="outline"
										className="text-[10px] px-1 py-0 bg-blue-500/10 text-blue-600 dark:text-blue-400 border-blue-500/20"
									>
										PK
									</Badge>
									<span>= Primary Key</span>
								</div>
								<div className="flex items-center gap-1">
									<Badge
										variant="outline"
										className="text-[10px] px-1 py-0 bg-orange-500/10 text-orange-600 dark:text-orange-400 border-orange-500/20"
									>
										FK
									</Badge>
									<span>= Foreign Key</span>
								</div>
								<div className="flex items-center gap-1">
									<span className="text-muted-foreground">?</span>
									<span>= Nullable</span>
								</div>
							</div>
						</div>
						<div className="flex items-center gap-2">
							<Sheet open={filterOpen} onOpenChange={setFilterOpen}>
								<SheetTrigger asChild>
									<Button variant="outline" size="sm">
										<Funnel className="w-4 h-4" />
										Filter ({selectedTables.size}/{allTableNames.length})
									</Button>
								</SheetTrigger>
								<SheetContent side="right" className="w-[400px]">
									<SheetHeader>
										<SheetTitle>Filter Tables</SheetTitle>
										<SheetDescription>
											Select which tables to display in the schema visualizer
										</SheetDescription>
									</SheetHeader>
									<div className="mt-6 space-y-4 px-1 pb-4">
										<div className="relative">
											<MagnifyingGlass className="absolute left-2 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
											<Input
												placeholder="Search tables"
												value={tableFilter}
												onChange={(e) => onTableFilterChange(e.target.value)}
												className="pl-8"
											/>
										</div>
										<div className="flex items-center gap-2">
											<Button variant="outline" size="sm" onClick={selectAll}>
												Select All
											</Button>
											<Button variant="outline" size="sm" onClick={deselectAll}>
												Deselect All
											</Button>
										</div>
										<div className="max-h-[calc(100vh-250px)] overflow-y-auto space-y-2 pr-2">
											{schemaOverview?.tables
												.filter((table) => {
													const fullName = `${table.schema}.${table.name}`;
													return (
														tableFilter === "" ||
														fullName
															.toLowerCase()
															.includes(tableFilter.toLowerCase()) ||
														table.name
															.toLowerCase()
															.includes(tableFilter.toLowerCase())
													);
												})
												.map((table) => {
													const fullName = `${table.schema}.${table.name}`;
													const isSelected = selectedTables.has(fullName);
													return (
														<div
															key={fullName}
															className="flex items-center justify-between p-2 rounded-lg hover:bg-muted/50"
														>
															<div className="flex flex-col min-w-0 flex-1">
																<span className="text-sm font-medium truncate">
																	{table.name}
																</span>
																<span className="text-xs text-muted-foreground">
																	{table.schema}
																</span>
															</div>
															<Switch
																checked={isSelected}
																onCheckedChange={() => toggleTable(fullName)}
															/>
														</div>
													);
												})}
										</div>
									</div>
								</SheetContent>
							</Sheet>
							<Button
								variant="outline"
								size="sm"
								onClick={() => setShowColumns(!showColumns)}
							>
								{showColumns ? "Hide Columns" : "Show Columns"}
							</Button>
							{onRefresh && (
								<Button variant="outline" size="sm" onClick={onRefresh}>
									<ArrowsClockwise className="w-4 h-4" />
									Refresh
								</Button>
							)}
						</div>
					</div>
				</CardHeader>
				<CardContent className="flex-1 min-h-0 flex items-center justify-center">
					<p className="text-muted-foreground">
						No tables selected. Use the filter to select tables.
					</p>
				</CardContent>
			</Card>
		);
	}

	return (
		<Card className="h-full flex flex-col">
			<CardHeader className="pb-3">
				<div className="flex items-center justify-between">
					<div className="flex flex-col gap-2">
						<CardTitle>Schema Visualizer</CardTitle>
						<div className="flex items-center gap-4 text-xs text-muted-foreground">
							<span className="font-medium">Legend:</span>
							<div className="flex items-center gap-1">
								<Badge
									variant="outline"
									className="text-[10px] px-1 py-0 bg-blue-500/10 text-blue-600 dark:text-blue-400 border-blue-500/20"
								>
									PK
								</Badge>
								<span>= Primary Key</span>
							</div>
							<div className="flex items-center gap-1">
								<Badge
									variant="outline"
									className="text-[10px] px-1 py-0 bg-orange-500/10 text-orange-600 dark:text-orange-400 border-orange-500/20"
								>
									FK
								</Badge>
								<span>= Foreign Key</span>
							</div>
							<div className="flex items-center gap-1">
								<span className="text-muted-foreground">?</span>
								<span>= Nullable</span>
							</div>
						</div>
					</div>
					<div className="flex items-center gap-2">
						<Sheet open={filterOpen} onOpenChange={setFilterOpen}>
							<SheetTrigger asChild>
								<Button variant="outline" size="sm">
									<Funnel className="w-4 h-4" />
									Filter ({selectedTables.size}/{allTableNames.length})
								</Button>
							</SheetTrigger>
							<SheetContent side="right" className="w-[400px]">
								<SheetHeader>
									<SheetTitle>Filter Tables</SheetTitle>
									<SheetDescription>
										Select which tables to display in the schema visualizer
									</SheetDescription>
								</SheetHeader>
								<div className="mt-6 space-y-4 px-1 pb-4">
									<div className="relative">
										<MagnifyingGlass className="absolute left-2 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
										<Input
											placeholder="Search tables"
											value={tableFilter}
											onChange={(e) => onTableFilterChange(e.target.value)}
											className="pl-8"
										/>
									</div>
									<div className="flex items-center gap-2">
										<Button variant="outline" size="sm" onClick={selectAll}>
											Select All
										</Button>
										<Button variant="outline" size="sm" onClick={deselectAll}>
											Deselect All
										</Button>
									</div>
									<div className="max-h-[calc(100vh-250px)] overflow-y-auto space-y-2 pr-2">
										{schemaOverview?.tables
											.filter((table) => {
												const fullName = `${table.schema}.${table.name}`;
												return (
													tableFilter === "" ||
													fullName
														.toLowerCase()
														.includes(tableFilter.toLowerCase()) ||
													table.name
														.toLowerCase()
														.includes(tableFilter.toLowerCase())
												);
											})
											.map((table) => {
												const fullName = `${table.schema}.${table.name}`;
												const isSelected = selectedTables.has(fullName);
												return (
													<div
														key={fullName}
														className="flex items-center justify-between p-2 rounded-lg hover:bg-muted/50"
													>
														<div className="flex flex-col min-w-0 flex-1">
															<span className="text-sm font-medium truncate">
																{table.name}
															</span>
															<span className="text-xs text-muted-foreground">
																{table.schema}
															</span>
														</div>
														<Switch
															checked={isSelected}
															onCheckedChange={() => toggleTable(fullName)}
														/>
													</div>
												);
											})}
									</div>
								</div>
							</SheetContent>
						</Sheet>
						<Button
							variant="outline"
							size="sm"
							onClick={() => setShowColumns(!showColumns)}
						>
							{showColumns ? "Hide Columns" : "Show Columns"}
						</Button>
						<Button
							variant="outline"
							size="sm"
							onClick={handleDownload}
							disabled={isDownloading}
						>
							{isDownloading ? (
								<Spinner className="w-4 h-4" />
							) : (
								<DownloadSimple className="w-4 h-4" />
							)}
							Export SVG
						</Button>
						{onRefresh && (
							<Button variant="outline" size="sm" onClick={onRefresh}>
								<ArrowsClockwise className="w-4 h-4" />
								Refresh
							</Button>
						)}
					</div>
				</div>
			</CardHeader>
			<CardContent className="flex-1 min-h-0">
				<div className="h-full w-full">
					<ReactFlowProvider>
						<SchemaVisualizerFlow
							nodes={nodes}
							edges={edges}
							onNodesChange={onNodesChange}
							onEdgesChange={onEdgesChange}
							onConnect={onConnect}
							nodeTypes={nodeTypes}
							downloadTrigger={downloadTrigger}
							onDownloadStateChange={setIsDownloading}
						/>
					</ReactFlowProvider>
				</div>
			</CardContent>
		</Card>
	);
}

function SchemaVisualizerFlow({
	nodes,
	edges,
	onNodesChange,
	onEdgesChange,
	onConnect,
	nodeTypes,
	downloadTrigger,
	onDownloadStateChange,
}: {
	nodes: Node[];
	edges: Edge[];
	onNodesChange: (changes: any) => void;
	onEdgesChange: (changes: any) => void;
	onConnect: (connection: Connection) => void;
	nodeTypes: any;
	downloadTrigger: number;
	onDownloadStateChange: (isDownloading: boolean) => void;
}) {
	const { fitView } = useReactFlow();
	const isDownloadingRef = useRef(false);

	useEffect(() => {
		if (nodes.length > 0) {
			setTimeout(() => {
				fitView({ padding: 0.1, minZoom: 0.05, maxZoom: 1 });
			}, 50);
		}
	}, [nodes, fitView]);

	useEffect(() => {
		if (downloadTrigger === 0) return;

		const getExportErrorMessage = (
			error: unknown,
			stage: "svg" | "dialog" | "write" | "reveal",
		) => {
			const message =
				typeof error === "string"
					? error
					: error instanceof Error
						? error.message
						: "";
			const lower = message.toLowerCase();

			if (
				lower.includes("permission") ||
				lower.includes("denied") ||
				lower.includes("eacces")
			) {
				return `Permission denied while saving the SVG. Choose a different folder or update permissions.${message ? ` (${message})` : ""}`;
			}

			if (
				lower.includes("no space") ||
				lower.includes("disk") ||
				lower.includes("quota") ||
				lower.includes("enospc")
			) {
				return `Not enough disk space to save the SVG.${message ? ` (${message})` : ""}`;
			}

			switch (stage) {
				case "svg":
					return `Failed to generate the SVG from the schema view.${message ? ` (${message})` : ""}`;
				case "dialog":
					return `Could not open the save dialog.${message ? ` (${message})` : ""}`;
				case "reveal":
					return `Saved the SVG, but couldn't reveal it in Finder.${message ? ` (${message})` : ""}`;
				default:
					return `Failed to write the SVG file.${message ? ` (${message})` : ""}`;
			}
		};

		const downloadImage = async () => {
			if (isDownloadingRef.current) return;
			isDownloadingRef.current = true;
			onDownloadStateChange(true);

			const reactFlowElement = document.querySelector(
				".react-flow",
			) as HTMLElement;
			if (!reactFlowElement) {
				console.error("Could not find .react-flow element");
				isDownloadingRef.current = false;
				onDownloadStateChange(false);
				return;
			}

			try {
				let svgData: string;
				try {
					svgData = await toSvg(reactFlowElement, {
						backgroundColor: "#ffffff",
						filter: (node) => {
							if (
								node?.classList?.contains("react-flow__minimap") ||
								node?.classList?.contains("react-flow__controls")
							) {
								return false;
							}
							return true;
						},
					});
				} catch (error) {
					console.error("Failed to generate SVG:", error);
					toast.error(getExportErrorMessage(error, "svg"));
					return;
				}

				let save: typeof import("@tauri-apps/plugin-dialog").save;
				let writeTextFile: typeof import("@tauri-apps/plugin-fs").writeTextFile;
				let revealItemInDir: typeof import("@tauri-apps/plugin-opener").revealItemInDir;

				try {
					({ save } = await import("@tauri-apps/plugin-dialog"));
					({ writeTextFile } = await import("@tauri-apps/plugin-fs"));
					({ revealItemInDir } = await import("@tauri-apps/plugin-opener"));
				} catch (error) {
					console.error("Failed to load export plugins:", error);
					toast.error(getExportErrorMessage(error, "dialog"));
					return;
				}

				const defaultName = `schema-${new Date().toISOString().split("T")[0]}.svg`;

				let filePath: string | null = null;
				try {
					filePath = await save({
						defaultPath: defaultName,
						filters: [{ name: "SVG Image", extensions: ["svg"] }],
					});
				} catch (error) {
					console.error("Failed to open save dialog:", error);
					toast.error(getExportErrorMessage(error, "dialog"));
					return;
				}

				if (!filePath) return;

				const svgContent = decodeURIComponent(
					svgData.replace(/^data:image\/svg\+xml;charset=utf-8,/, ""),
				);

				try {
					await writeTextFile(filePath, svgContent);
				} catch (error) {
					console.error("Failed to write SVG file:", error);
					toast.error(getExportErrorMessage(error, "write"));
					return;
				}

				toast.success("Schema exported successfully", {
					action: {
						label: "Show in Finder",
						onClick: async () => {
							try {
								await revealItemInDir(filePath);
							} catch (error) {
								console.error("Failed to reveal exported file:", error);
								toast.error(getExportErrorMessage(error, "reveal"));
							}
						},
					},
				});
			} catch (error) {
				console.error("Failed to download image:", error);
				toast.error(getExportErrorMessage(error, "write"));
			} finally {
				isDownloadingRef.current = false;
				onDownloadStateChange(false);
			}
		};

		downloadImage();
	}, [downloadTrigger, onDownloadStateChange]);

	return (
		<ReactFlow
			nodes={nodes}
			edges={edges}
			onNodesChange={onNodesChange}
			onEdgesChange={onEdgesChange}
			onConnect={onConnect}
			nodeTypes={nodeTypes}
			minZoom={0.05}
			maxZoom={2}
			className="bg-background"
			proOptions={{ hideAttribution: true }}
		>
			<Background />
			<Controls />
		</ReactFlow>
	);
}
