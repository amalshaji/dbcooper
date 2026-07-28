import { json } from "@codemirror/lang-json";
import {
	CaretDown,
	CaretRight,
	Database,
	FilePlus,
	FloppyDisk,
	Play,
	Plus,
	Trash,
} from "@phosphor-icons/react";
import { useVirtualizer } from "@tanstack/react-virtual";
import CodeMirror from "@uiw/react-codemirror";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import { ConnectionWorkspaceHeader } from "@/components/connection-details/ConnectionHeaders";
import { MongoCollectionAdmin } from "@/components/connection-details/MongoCollectionAdmin";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Spinner } from "@/components/ui/spinner";
import type { ConnectionLifecycleController } from "@/hooks/connection-details/useConnectionLifecycle";
import {
	api,
	type MongoDatabaseInfo,
	type MongoDocumentPage,
	type QueryHistory,
	type SavedQuery,
} from "@/lib/tauri";
import type { MongoConnection } from "@/types/connection";

type QueryMode = "find" | "aggregate";
type CollectionView = "documents" | "indexes" | "validation";

interface MongoConnectionWorkspaceProps {
	connection: MongoConnection;
	lifecycle: ConnectionLifecycleController;
	onClose: () => void;
	onOpenSettings: () => void;
}

function parseObject(value: string, label: string): Record<string, unknown> {
	const parsed: unknown = JSON.parse(value);
	if (!parsed || Array.isArray(parsed) || typeof parsed !== "object") {
		throw new Error(`${label} must be a JSON object`);
	}
	return parsed as Record<string, unknown>;
}

function parsePipeline(value: string): Record<string, unknown>[] {
	const parsed: unknown = JSON.parse(value);
	if (
		!Array.isArray(parsed) ||
		parsed.some(
			(stage) => !stage || typeof stage !== "object" || Array.isArray(stage),
		)
	) {
		throw new Error("Pipeline must be an array of JSON objects");
	}
	return parsed as Record<string, unknown>[];
}

function documentSummary(document: Record<string, unknown>) {
	return Object.entries(document)
		.slice(0, 3)
		.map(
			([key, value]) =>
				`${key}: ${typeof value === "object" ? JSON.stringify(value) : String(value)}`,
		)
		.join(" · ");
}

export function MongoConnectionWorkspace({
	connection,
	lifecycle,
	onClose,
	onOpenSettings,
}: MongoConnectionWorkspaceProps) {
	const [catalog, setCatalog] = useState<MongoDatabaseInfo[]>([]);
	const [expanded, setExpanded] = useState<Set<string>>(new Set());
	const [database, setDatabase] = useState("");
	const [collection, setCollection] = useState("");
	const [mode, setMode] = useState<QueryMode>("find");
	const [collectionView, setCollectionView] =
		useState<CollectionView>("documents");
	const [filter, setFilter] = useState("{}");
	const [projection, setProjection] = useState("{}");
	const [sort, setSort] = useState("{}");
	const [pipeline, setPipeline] = useState("[]");
	const [result, setResult] = useState<MongoDocumentPage | null>(null);
	const [selectedIndex, setSelectedIndex] = useState<number | null>(null);
	const [documentText, setDocumentText] = useState("{}");
	const [isNewDocument, setIsNewDocument] = useState(false);
	const [loading, setLoading] = useState(false);
	const [savedQueries, setSavedQueries] = useState<SavedQuery[]>([]);
	const [history, setHistory] = useState<QueryHistory[]>([]);
	const [queryName, setQueryName] = useState("");
	const [inspectorWidth, setInspectorWidth] = useState(440);
	const listRef = useRef<HTMLDivElement>(null);

	const selectedDocument =
		selectedIndex === null ? null : (result?.documents[selectedIndex] ?? null);

	useEffect(() => {
		if (selectedDocument && !isNewDocument) {
			setDocumentText(JSON.stringify(selectedDocument, null, 2));
		}
	}, [selectedDocument, isNewDocument]);

	const refreshRecords = useCallback(async () => {
		const [saved, recent] = await Promise.all([
			api.queries.list(connection.uuid),
			api.queries.history(connection.uuid),
		]);
		setSavedQueries(
			saved.filter((item) => item.query_kind?.startsWith("mongo_")),
		);
		setHistory(recent.filter((item) => item.query_kind?.startsWith("mongo_")));
	}, [connection.uuid]);

	const refreshCatalog = useCallback(async () => {
		try {
			const next = await api.mongo.listCatalog(connection.uuid);
			setCatalog(next);
			if (!database && next[0]?.collections[0]) {
				setDatabase(next[0].name);
				setCollection(next[0].collections[0].name);
				setExpanded(new Set([next[0].name]));
			}
		} catch (error) {
			toast.error("Could not load MongoDB catalog", {
				description: String(error),
			});
		}
	}, [connection.uuid, database]);

	useEffect(() => {
		void refreshCatalog();
		void refreshRecords();
	}, [refreshCatalog, refreshRecords]);

	const run = useCallback(async () => {
		if (!database || !collection) {
			toast.error("Select a MongoDB collection first");
			return;
		}
		setLoading(true);
		const started = performance.now();
		try {
			const next =
				mode === "find"
					? await api.mongo.find(connection.uuid, {
							database,
							collection,
							filter: parseObject(filter, "Filter"),
							projection: parseObject(projection, "Projection"),
							sort: parseObject(sort, "Sort"),
							limit: 100,
						})
					: await api.mongo.aggregate(connection.uuid, {
							database,
							collection,
							pipeline: parsePipeline(pipeline),
							limit: 100,
						});
			setResult(next);
			setSelectedIndex(next.documents.length > 0 ? 0 : null);
			setIsNewDocument(false);
			const spec = JSON.stringify({
				version: 1,
				type: mode,
				database,
				collection,
				...(mode === "find"
					? {
							filter: parseObject(filter, "Filter"),
							projection: parseObject(projection, "Projection"),
							sort: parseObject(sort, "Sort"),
							limit: 100,
						}
					: { pipeline: parsePipeline(pipeline), limit: 100 }),
			});
			await api.queries.recordHistory({
				connectionUuid: connection.uuid,
				query: spec,
				queryKind: mode === "find" ? "mongo_find" : "mongo_aggregate",
				status: "success",
				timeTakenMs: Math.round(performance.now() - started),
				rowCount: next.returned_count,
			});
			void refreshRecords();
		} catch (error) {
			toast.error("MongoDB query failed", { description: String(error) });
		} finally {
			setLoading(false);
		}
	}, [
		collection,
		connection.uuid,
		database,
		filter,
		mode,
		pipeline,
		projection,
		refreshRecords,
		sort,
	]);

	useEffect(() => {
		if (database && collection) void run();
		// Collection selection intentionally runs the default find once.
		// eslint-disable-next-line react-hooks/exhaustive-deps
	}, [database, collection]);

	const virtualizer = useVirtualizer({
		count: result?.documents.length ?? 0,
		getScrollElement: () => listRef.current,
		estimateSize: () => 58,
		overscan: 8,
	});

	const saveQuery = async () => {
		if (!queryName.trim()) {
			toast.error("Enter a name for this query");
			return;
		}
		try {
			const query = JSON.stringify({
				version: 1,
				type: mode,
				database,
				collection,
				...(mode === "find"
					? {
							filter: parseObject(filter, "Filter"),
							projection: parseObject(projection, "Projection"),
							sort: parseObject(sort, "Sort"),
							limit: 100,
						}
					: { pipeline: parsePipeline(pipeline), limit: 100 }),
			});
			await api.queries.create(connection.uuid, {
				name: queryName.trim(),
				query,
				query_kind: mode === "find" ? "mongo_find" : "mongo_aggregate",
			});
			setQueryName("");
			await refreshRecords();
			toast.success("Query saved");
		} catch (error) {
			toast.error("Could not save query", { description: String(error) });
		}
	};

	const loadSpec = (query: string) => {
		try {
			const spec = JSON.parse(query) as Record<string, unknown>;
			if (
				spec.version !== 1 ||
				(spec.type !== "find" && spec.type !== "aggregate")
			) {
				throw new Error("Unsupported MongoDB query format");
			}
			setMode(spec.type);
			setDatabase(String(spec.database));
			setCollection(String(spec.collection));
			if (spec.type === "find") {
				setFilter(JSON.stringify(spec.filter ?? {}, null, 2));
				setProjection(JSON.stringify(spec.projection ?? {}, null, 2));
				setSort(JSON.stringify(spec.sort ?? {}, null, 2));
			} else {
				setPipeline(JSON.stringify(spec.pipeline ?? [], null, 2));
			}
		} catch (error) {
			toast.error("Could not load saved query", { description: String(error) });
		}
	};

	const saveDocument = async () => {
		try {
			const document = parseObject(documentText, "Document");
			if (isNewDocument) {
				await api.mongo.insertOne(connection.uuid, {
					database,
					collection,
					document,
				});
			} else {
				const id = selectedDocument?._id;
				if (id === undefined) throw new Error("Selected document has no _id");
				await api.mongo.replaceOne(connection.uuid, {
					database,
					collection,
					id,
					document,
				});
			}
			toast.success(isNewDocument ? "Document inserted" : "Document saved");
			await run();
		} catch (error) {
			toast.error("Could not save document", { description: String(error) });
		}
	};

	const deleteDocument = async () => {
		const id = selectedDocument?._id;
		if (
			id === undefined ||
			!window.confirm(`Delete document ${JSON.stringify(id)}?`)
		)
			return;
		try {
			await api.mongo.deleteOne(connection.uuid, { database, collection, id });
			toast.success("Document deleted");
			await run();
		} catch (error) {
			toast.error("Could not delete document", { description: String(error) });
		}
	};

	const beginResize = (event: React.PointerEvent) => {
		const startX = event.clientX;
		const startWidth = inspectorWidth;
		const move = (next: PointerEvent) =>
			setInspectorWidth(
				Math.min(720, Math.max(300, startWidth + startX - next.clientX)),
			);
		const stop = () => {
			window.removeEventListener("pointermove", move);
			window.removeEventListener("pointerup", stop);
		};
		window.addEventListener("pointermove", move);
		window.addEventListener("pointerup", stop);
	};

	const jsonExtension = useMemo(() => [json()], []);

	return (
		<div className="workspace-canvas flex h-screen flex-col">
			<ConnectionWorkspaceHeader
				connection={connection}
				onClose={onClose}
				connectionStatus={lifecycle.connection.status}
				onReconnect={lifecycle.commands.reconnect}
				onStatusChange={lifecycle.commands.recordConnectionStatus}
				onOpenSettings={onOpenSettings}
			/>
			<div className="flex min-h-0 flex-1">
				<aside className="w-60 shrink-0 overflow-auto border-r bg-sidebar p-2">
					<div className="mb-2 flex items-center justify-between px-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
						<span>Databases</span>
						<div className="flex">
							<Button
								size="icon-xs"
								variant="ghost"
								onClick={async () => {
									const namespace = window.prompt(
										"New collection (database.collection)",
									);
									if (!namespace) return;
									const separator = namespace.indexOf(".");
									if (separator < 1 || separator === namespace.length - 1)
										return toast.error("Use database.collection");
									try {
										await api.mongo.createCollection(
											connection.uuid,
											namespace.slice(0, separator),
											namespace.slice(separator + 1),
										);
										await refreshCatalog();
										toast.success("Collection created");
									} catch (error) {
										toast.error("Could not create collection", {
											description: String(error),
										});
									}
								}}
								aria-label="Create collection"
							>
								<Plus />
							</Button>
							<Button
								size="icon-xs"
								variant="ghost"
								onClick={() => void refreshCatalog()}
								aria-label="Refresh catalog"
							>
								<Database />
							</Button>
						</div>
					</div>
					{catalog.map((db) => (
						<div key={db.name}>
							<button
								className="flex w-full items-center gap-1 rounded px-2 py-1 text-left text-sm hover:bg-accent"
								onClick={() =>
									setExpanded((current) => {
										const next = new Set(current);
										if (next.has(db.name)) {
											next.delete(db.name);
										} else {
											next.add(db.name);
										}
										return next;
									})
								}
							>
								{expanded.has(db.name) ? <CaretDown /> : <CaretRight />}{" "}
								{db.name}
							</button>
							{expanded.has(db.name) &&
								db.collections.map((item) => (
									<button
										key={item.name}
										className={`w-full truncate rounded py-1 pl-7 pr-2 text-left text-sm ${database === db.name && collection === item.name ? "bg-accent font-medium" : "hover:bg-accent"}`}
										onClick={() => {
											setMode("find");
											setDatabase(db.name);
											setCollection(item.name);
										}}
									>
										{item.name}
									</button>
								))}
						</div>
					))}
					<div className="mt-5 border-t pt-3">
						<div className="px-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
							Saved
						</div>
						{savedQueries.map((item) => (
							<button
								key={item.id}
								className="block w-full truncate rounded px-2 py-1 text-left text-sm hover:bg-accent"
								onClick={() => loadSpec(item.query)}
							>
								{item.name}
							</button>
						))}
					</div>
					<div className="mt-4 border-t pt-3">
						<div className="px-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
							History
						</div>
						{history.slice(0, 5).map((item) => (
							<button
								key={item.id}
								className="block w-full truncate rounded px-2 py-1 text-left text-xs text-muted-foreground hover:bg-accent"
								onClick={() => loadSpec(item.query)}
							>
								{item.query_kind?.replace("mongo_", "") ?? "query"} ·{" "}
								{item.row_count ?? 0} docs
							</button>
						))}
					</div>
				</aside>

				<main className="relative flex min-w-0 flex-1 flex-col">
					<div className="flex items-center gap-2 border-b p-2">
						<Button
							size="sm"
							variant={collectionView === "documents" ? "secondary" : "ghost"}
							onClick={() => setCollectionView("documents")}
						>
							Documents
						</Button>
						<Button
							size="sm"
							variant={collectionView === "indexes" ? "secondary" : "ghost"}
							onClick={() => setCollectionView("indexes")}
						>
							Indexes
						</Button>
						<Button
							size="sm"
							variant={collectionView === "validation" ? "secondary" : "ghost"}
							onClick={() => setCollectionView("validation")}
						>
							Validation
						</Button>
						{collectionView === "documents" && (
							<>
								<span className="mx-1 h-5 border-l" />
								<Button
									size="sm"
									variant={mode === "find" ? "secondary" : "ghost"}
									onClick={() => setMode("find")}
								>
									Find
								</Button>
								<Button
									size="sm"
									variant={mode === "aggregate" ? "secondary" : "ghost"}
									onClick={() => setMode("aggregate")}
								>
									Aggregate
								</Button>
							</>
						)}
						<span className="ml-2 truncate text-sm text-muted-foreground">
							{database && collection
								? `${database}.${collection}`
								: "Select a collection"}
						</span>
						{collection && (
							<Button
								size="icon-sm"
								variant="ghost"
								aria-label="Drop collection"
								onClick={async () => {
									const namespace = `${database}.${collection}`;
									if (
										window.prompt(
											`Type ${namespace} to drop this collection`,
										) !== namespace
									)
										return;
									try {
										await api.mongo.dropCollection(
											connection.uuid,
											database,
											collection,
										);
										setCollection("");
										setResult(null);
										await refreshCatalog();
										toast.success("Collection dropped");
									} catch (error) {
										toast.error("Could not drop collection", {
											description: String(error),
										});
									}
								}}
							>
								<Trash />
							</Button>
						)}
						<div className="ml-auto flex items-center gap-2">
							<Input
								className="h-8 w-40"
								value={queryName}
								onChange={(event) => setQueryName(event.target.value)}
								placeholder="Saved query name"
							/>
							<Button
								size="sm"
								variant="outline"
								onClick={() => void saveQuery()}
							>
								<FloppyDisk />
								Save
							</Button>
							<Button
								size="sm"
								onClick={() => void run()}
								disabled={loading || !collection}
							>
								{loading && <Spinner />}
								<Play />
								Run
							</Button>
						</div>
						{collectionView !== "documents" && (
							<div className="absolute inset-x-0 bottom-0 top-[49px] z-20 flex bg-background">
								<MongoCollectionAdmin
									uuid={connection.uuid}
									database={database}
									collection={collection}
									view={collectionView}
								/>
							</div>
						)}
					</div>
					<div
						className="grid border-b bg-card"
						style={{
							gridTemplateColumns: mode === "find" ? "1fr 1fr 1fr" : "1fr",
						}}
					>
						{mode === "find" ? (
							<>
								<div className="border-r">
									<div className="px-3 py-1 text-xs text-muted-foreground">
										Filter
									</div>
									<CodeMirror
										value={filter}
										height="120px"
										extensions={jsonExtension}
										onChange={setFilter}
									/>
								</div>
								<div className="border-r">
									<div className="px-3 py-1 text-xs text-muted-foreground">
										Projection
									</div>
									<CodeMirror
										value={projection}
										height="120px"
										extensions={jsonExtension}
										onChange={setProjection}
									/>
								</div>
								<div>
									<div className="px-3 py-1 text-xs text-muted-foreground">
										Sort
									</div>
									<CodeMirror
										value={sort}
										height="120px"
										extensions={jsonExtension}
										onChange={setSort}
									/>
								</div>
							</>
						) : (
							<div>
								<div className="px-3 py-1 text-xs text-muted-foreground">
									Pipeline
								</div>
								<CodeMirror
									value={pipeline}
									height="120px"
									extensions={jsonExtension}
									onChange={setPipeline}
								/>
							</div>
						)}
					</div>
					<div className="flex min-h-0 flex-1">
						<section ref={listRef} className="min-w-0 flex-1 overflow-auto">
							<div className="sticky top-0 z-10 flex h-10 items-center border-b bg-background px-3 text-xs text-muted-foreground">
								{result
									? `${result.returned_count} documents${result.has_more ? "+" : ""} · ${result.execution_time_ms} ms`
									: "Run a query to browse documents"}
								<Button
									className="ml-auto"
									size="sm"
									variant="ghost"
									onClick={() => {
										setIsNewDocument(true);
										setSelectedIndex(null);
										setDocumentText("{\n  \n}");
									}}
								>
									<FilePlus />
									New document
								</Button>
							</div>
							<div
								className="relative"
								style={{ height: virtualizer.getTotalSize() }}
							>
								{virtualizer.getVirtualItems().map((row) => {
									const document = result?.documents[row.index];
									if (!document) return null;
									return (
										<button
											key={row.key}
											className={`absolute left-0 top-0 w-full border-b px-3 py-2 text-left hover:bg-accent ${selectedIndex === row.index ? "bg-accent" : ""}`}
											style={{
												height: row.size,
												transform: `translateY(${row.start}px)`,
											}}
											onClick={() => {
												setIsNewDocument(false);
												setSelectedIndex(row.index);
											}}
										>
											<div className="truncate font-mono text-xs">
												{documentSummary(document)}
											</div>
											<div className="mt-1 truncate text-[11px] text-muted-foreground">
												{JSON.stringify(document._id ?? "No _id")}
											</div>
										</button>
									);
								})}
							</div>
						</section>
						<div
							role="separator"
							aria-label="Resize document inspector"
							aria-orientation="vertical"
							tabIndex={0}
							className="w-1 cursor-col-resize bg-border hover:bg-primary/40 focus:bg-primary/40"
							onPointerDown={beginResize}
							onKeyDown={(event) => {
								if (event.key === "ArrowLeft")
									setInspectorWidth((value) => Math.min(720, value + 20));
								if (event.key === "ArrowRight")
									setInspectorWidth((value) => Math.max(300, value - 20));
							}}
						/>
						<aside
							className="flex shrink-0 flex-col overflow-hidden bg-card"
							style={{ width: inspectorWidth }}
						>
							<div className="flex h-10 items-center gap-2 border-b px-3 text-sm font-medium">
								{isNewDocument
									? "New document"
									: selectedDocument
										? "Document"
										: "Inspector"}
								{(isNewDocument || selectedDocument) && (
									<>
										<Button
											className="ml-auto"
											size="sm"
											onClick={() => void saveDocument()}
										>
											<FloppyDisk />
											{isNewDocument ? "Insert" : "Save"}
										</Button>
										{selectedDocument && (
											<Button
												size="sm"
												variant="destructive"
												onClick={() => void deleteDocument()}
											>
												<Trash />
												Delete
											</Button>
										)}
									</>
								)}
							</div>
							<CodeMirror
								className="min-h-0 flex-1 overflow-auto"
								value={documentText}
								height="100%"
								extensions={jsonExtension}
								onChange={setDocumentText}
								editable={isNewDocument || Boolean(selectedDocument)}
							/>
						</aside>
					</div>
				</main>
			</div>
		</div>
	);
}
