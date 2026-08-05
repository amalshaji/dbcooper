import { useCallback, useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { LatestRequestRegistry } from "../../lib/connection-details/latestRequestRegistry";
import {
	buildMongoQuerySpec,
	mongoQueryKind,
	parseMongoQuerySpec,
	queryEditorFromSpec,
	serializeMongoQuerySpec,
	type JsonObject,
	type MongoNamespace,
	type MongoQueryEditor,
} from "../../lib/mongo/querySpec";
import {
	api,
	type MongoDatabaseInfo,
	type MongoDocumentPage,
	type QueryHistory,
	type SavedQuery,
} from "../../lib/tauri";

const DEFAULT_FIND_EDITOR: Extract<MongoQueryEditor, { type: "find" }> = {
	type: "find",
	filter: "{}",
	projection: "{}",
	sort: "{}",
	limit: 100,
};
const DEFAULT_AGGREGATE_EDITOR: Extract<
	MongoQueryEditor,
	{ type: "aggregate" }
> = {
	type: "aggregate",
	pipeline: "[]",
	limit: 100,
};

interface EditorSession {
	mode: MongoQueryEditor["type"];
	find: Extract<MongoQueryEditor, { type: "find" }>;
	aggregate: Extract<MongoQueryEditor, { type: "aggregate" }>;
}

interface InspectorState {
	selectedIndex: number | null;
	documentText: string;
	isNew: boolean;
}

interface QueryResultState {
	page: MongoDocumentPage;
	namespace: MongoNamespace;
	allowsDocumentMutations: boolean;
}

function parseDocument(value: string): JsonObject {
	const parsed: unknown = JSON.parse(value);
	if (!parsed || Array.isArray(parsed) || typeof parsed !== "object") {
		throw new Error("Document must be a JSON object");
	}
	return parsed as JsonObject;
}

export function useMongoWorkbench(uuid: string) {
	const [catalog, setCatalog] = useState<MongoDatabaseInfo[]>([]);
	const [expanded, setExpanded] = useState<Set<string>>(new Set());
	const [namespace, setNamespace] = useState<MongoNamespace>({
		database: "",
		collection: "",
	});
	const [editorSession, setEditorSession] = useState<EditorSession>({
		mode: "find",
		find: DEFAULT_FIND_EDITOR,
		aggregate: DEFAULT_AGGREGATE_EDITOR,
	});
	const editor = editorSession[editorSession.mode];
	const [queryResult, setQueryResult] = useState<QueryResultState | null>(null);
	const result = queryResult?.page ?? null;
	const resultNamespace = queryResult?.namespace ?? null;
	const [inspector, setInspector] = useState<InspectorState>({
		selectedIndex: null,
		documentText: "{}",
		isNew: false,
	});
	const [loading, setLoading] = useState(false);
	const [documentMutating, setDocumentMutating] = useState(false);
	const [savedQueries, setSavedQueries] = useState<SavedQuery[]>([]);
	const [history, setHistory] = useState<QueryHistory[]>([]);
	const [queryName, setQueryName] = useState("");
	const [editorLoadRevision, setEditorLoadRevision] = useState(0);
	const [showSystemCollections, setShowSystemCollections] = useState(false);
	const initializedCatalog = useRef(false);
	const suppressNextNamespaceRun = useRef(false);
	const requests = useRef(new LatestRequestRegistry());
	const documentMutationInFlight = useRef(false);

	const namespaceReadOnly = catalog.some((database) =>
		database.collections.some(
			(collection) =>
				collection.database === namespace.database &&
				collection.name === namespace.collection &&
				collection.is_system,
		),
	);

	const selectedDocument =
		inspector.selectedIndex === null
			? null
			: (result?.documents[inspector.selectedIndex] ?? null);
	const canMutateSelectedDocument =
		!namespaceReadOnly &&
		Boolean(selectedDocument) &&
		Boolean(queryResult?.allowsDocumentMutations);
	const canEditDocument =
		!namespaceReadOnly && (inspector.isNew || canMutateSelectedDocument);

	useEffect(() => {
		if (selectedDocument && !inspector.isNew) {
			setInspector((current) => ({
				...current,
				documentText: JSON.stringify(selectedDocument, null, 2),
			}));
		}
	}, [selectedDocument, inspector.isNew]);

	const refreshRecords = useCallback(async () => {
		const request = requests.current.issue("records");
		const [saved, recent] = await Promise.all([
			api.queries.list(uuid),
			api.queries.history(uuid),
		]);
		if (!requests.current.isLatest(request)) return;
		setSavedQueries(
			saved.filter((item) => item.query_kind.startsWith("mongo_")),
		);
		setHistory(recent.filter((item) => item.query_kind.startsWith("mongo_")));
	}, [uuid]);

	const refreshCatalog = useCallback(async () => {
		const request = requests.current.issue("catalog");
		try {
			const next = await api.mongo.listCatalog(uuid);
			if (!requests.current.isLatest(request)) return;
			setCatalog(next);
			const first = next
				.flatMap((database) => database.collections)
				.find((collection) => !collection.is_system);
			if (!initializedCatalog.current && first) {
				initializedCatalog.current = true;
				setExpanded(new Set([first.database]));
				setNamespace({ database: first.database, collection: first.name });
			}
		} catch (error) {
			if (!requests.current.isLatest(request)) return;
			toast.error("Could not load MongoDB catalog", {
				description: String(error),
			});
		}
	}, [uuid]);

	useEffect(() => {
		const registry = requests.current;
		void refreshCatalog();
		void refreshRecords();
		return () => registry.invalidateAll();
	}, [refreshCatalog, refreshRecords]);

	const run = useCallback(async () => {
		if (!namespace.database || !namespace.collection) {
			toast.error("Select a MongoDB collection first");
			return;
		}
		const request = requests.current.issue("query");
		setLoading(true);
		const started = performance.now();
		try {
			const spec = buildMongoQuerySpec(editor, namespace);
			const next =
				spec.type === "find"
					? await api.mongo.find(uuid, spec)
					: await api.mongo.aggregate(uuid, spec);
			await api.queries.recordHistory({
				connectionUuid: uuid,
				query: serializeMongoQuerySpec(spec),
				queryKind: mongoQueryKind(spec),
				status: "success",
				timeTakenMs: Math.round(performance.now() - started),
				rowCount: next.returned_count,
			});
			if (!requests.current.isLatest(request)) return;
			setQueryResult({
				page: next,
				namespace,
				allowsDocumentMutations:
					spec.type === "find" && Object.keys(spec.projection).length === 0,
			});
			setInspector((current) => ({
				...current,
				selectedIndex: next.documents.length > 0 ? 0 : null,
				isNew: false,
			}));
			void refreshRecords();
		} catch (error) {
			if (!requests.current.isLatest(request)) return;
			toast.error("MongoDB query failed", { description: String(error) });
		} finally {
			if (requests.current.isLatest(request)) setLoading(false);
		}
	}, [editor, namespace, refreshRecords, uuid]);

	useEffect(() => {
		if (!namespace.database || !namespace.collection) return;
		if (suppressNextNamespaceRun.current) {
			suppressNextNamespaceRun.current = false;
			return;
		}
		void run();
		// Namespace changes intentionally run the default query once.
		// eslint-disable-next-line react-hooks/exhaustive-deps
	}, [namespace]);

	const saveQuery = useCallback(async () => {
		if (!queryName.trim()) {
			toast.error("Enter a name for this query");
			return;
		}
		try {
			const spec = buildMongoQuerySpec(editor, namespace);
			await api.queries.create(uuid, {
				name: queryName.trim(),
				query: serializeMongoQuerySpec(spec),
				query_kind: mongoQueryKind(spec),
			});
			setQueryName("");
			await refreshRecords();
			toast.success("Query saved");
		} catch (error) {
			toast.error("Could not save query", { description: String(error) });
		}
	}, [editor, namespace, queryName, refreshRecords, uuid]);

	const loadQuery = useCallback((query: string) => {
		try {
			const spec = parseMongoQuerySpec(query);
			requests.current.invalidate("query");
			suppressNextNamespaceRun.current = true;
			setNamespace({ database: spec.database, collection: spec.collection });
			const nextEditor = queryEditorFromSpec(spec);
			setEditorSession((current) => ({
				...current,
				mode: nextEditor.type,
				[nextEditor.type]: nextEditor,
			}));
			setEditorLoadRevision((current) => current + 1);
			setQueryResult(null);
			setLoading(false);
			setInspector({
				selectedIndex: null,
				documentText: "{}",
				isNew: false,
			});
		} catch (error) {
			toast.error("Could not load saved query", { description: String(error) });
		}
	}, []);

	const createCollection = useCallback(
		async (value: string) => {
			const separator = value.indexOf(".");
			const database =
				separator === -1 ? namespace.database : value.slice(0, separator);
			const collection = separator === -1 ? value : value.slice(separator + 1);
			if (!database || !collection) {
				throw new Error("Enter a collection name or database.collection");
			}
			await api.mongo.createCollection(uuid, database, collection);
			await refreshCatalog();
			requests.current.invalidate("query");
			setLoading(false);
			setQueryResult(null);
			setExpanded((current) => new Set(current).add(database));
			setEditorSession((current) => ({ ...current, mode: "find" }));
			setNamespace({ database, collection });
		},
		[namespace.database, refreshCatalog, uuid],
	);

	const dropCollection = useCallback(async () => {
		if (namespaceReadOnly) {
			throw new Error("MongoDB system collections are read-only in DBcooper");
		}
		await api.mongo.dropCollection(
			uuid,
			namespace.database,
			namespace.collection,
		);
		requests.current.invalidate("query");
		setLoading(false);
		setNamespace((current) => ({ ...current, collection: "" }));
		setQueryResult(null);
		await refreshCatalog();
	}, [namespace, namespaceReadOnly, refreshCatalog, uuid]);

	const saveDocument = useCallback(async () => {
		if (documentMutationInFlight.current) return;
		documentMutationInFlight.current = true;
		setDocumentMutating(true);
		try {
			if (!canEditDocument) {
				throw new Error(
					namespaceReadOnly
						? "MongoDB system collections are read-only in DBcooper"
						: "Only complete documents from unprojected find results can be replaced",
				);
			}
			const document = parseDocument(inspector.documentText);
			if (inspector.isNew) {
				await api.mongo.insertOne(uuid, { ...namespace, document });
			} else {
				const id = selectedDocument?._id;
				if (id === undefined) throw new Error("Selected document has no _id");
				await api.mongo.replaceOne(uuid, { ...namespace, id, document });
			}
			toast.success(inspector.isNew ? "Document inserted" : "Document saved");
			await run();
		} catch (error) {
			toast.error("Could not save document", { description: String(error) });
		} finally {
			documentMutationInFlight.current = false;
			setDocumentMutating(false);
		}
	}, [
		canEditDocument,
		inspector,
		namespace,
		namespaceReadOnly,
		run,
		selectedDocument,
		uuid,
	]);

	const deleteDocument = useCallback(async () => {
		const id = selectedDocument?._id;
		if (id === undefined) return;
		if (documentMutationInFlight.current) return;
		documentMutationInFlight.current = true;
		setDocumentMutating(true);
		try {
			if (!canMutateSelectedDocument) {
				throw new Error(
					"Only documents from unprojected find results can be deleted",
				);
			}
			await api.mongo.deleteOne(uuid, { ...namespace, id });
			toast.success("Document deleted");
			await run();
		} catch (error) {
			toast.error("Could not delete document", { description: String(error) });
		} finally {
			documentMutationInFlight.current = false;
			setDocumentMutating(false);
		}
	}, [canMutateSelectedDocument, namespace, run, selectedDocument, uuid]);

	return {
		catalog,
		expanded,
		namespace,
		editor,
		result,
		resultNamespace,
		inspector,
		selectedDocument,
		loading,
		documentMutating,
		savedQueries,
		history,
		queryName,
		editorLoadRevision,
		showSystemCollections,
		namespaceReadOnly,
		canMutateSelectedDocument,
		canEditDocument,
		actions: {
			setEditor: (nextEditor: MongoQueryEditor) =>
				setEditorSession((current) => ({
					...current,
					[nextEditor.type]: nextEditor,
				})),
			setMode: (mode: MongoQueryEditor["type"]) =>
				setEditorSession((current) => ({ ...current, mode })),
			setQueryName,
			setShowSystemCollections,
			refreshCatalog,
			run,
			saveQuery,
			loadQuery,
			createCollection,
			dropCollection,
			toggleDatabase: (database: string) =>
				setExpanded((current) => {
					const next = new Set(current);
					if (next.has(database)) next.delete(database);
					else next.add(database);
					return next;
				}),
			selectCollection: (database: string, collection: string) => {
				requests.current.invalidate("query");
				setLoading(false);
				setQueryResult(null);
				setInspector({
					selectedIndex: null,
					documentText: "{}",
					isNew: false,
				});
				setEditorSession((current) => ({ ...current, mode: "find" }));
				setNamespace({ database, collection });
			},
			selectDocument: (selectedIndex: number) =>
				setInspector((current) => ({
					...current,
					selectedIndex,
					isNew: false,
				})),
			beginDocument: () =>
				setInspector({
					selectedIndex: null,
					documentText: "{\n  \n}",
					isNew: true,
				}),
			setDocumentText: (documentText: string) =>
				setInspector((current) => ({ ...current, documentText })),
			saveDocument,
			deleteDocument,
		},
	};
}

export type MongoWorkbenchController = ReturnType<typeof useMongoWorkbench>;
