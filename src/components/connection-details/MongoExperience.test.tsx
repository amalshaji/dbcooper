import { expect, mock, test } from "bun:test";
import type { ComponentProps, ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import type { MongoWorkbenchController } from "../../hooks/connection-details/useMongoWorkbench";

mock.module("@/components/connection-details/MongoJsonEditor", () => ({
	MongoJsonEditor: ({
		className,
		ariaLabel,
		editable,
	}: {
		className?: string;
		ariaLabel?: string;
		editable?: boolean;
	}) => (
		<div
			data-mongo-json-editor
			data-editable={editable}
			className={className}
			aria-label={ariaLabel}
		/>
	),
}));
mock.module("@tanstack/react-virtual", () => ({
	useVirtualizer: () => ({
		getTotalSize: () => 0,
		getVirtualItems: () => [],
	}),
}));
mock.module("@/components/ui/alert-dialog", () => ({
	AlertDialog: ({ children }: { children: ReactNode }) => <>{children}</>,
	AlertDialogAction: (props: ComponentProps<"button">) => <button {...props} />,
	AlertDialogCancel: (props: ComponentProps<"button">) => <button {...props} />,
	AlertDialogContent: ({ children }: { children: ReactNode }) => (
		<>{children}</>
	),
	AlertDialogDescription: ({ children }: { children: ReactNode }) => (
		<p>{children}</p>
	),
	AlertDialogFooter: ({ children }: { children: ReactNode }) => <>{children}</>,
	AlertDialogHeader: ({ children }: { children: ReactNode }) => <>{children}</>,
	AlertDialogTitle: ({ children }: { children: ReactNode }) => (
		<h2>{children}</h2>
	),
}));
mock.module("@/components/ui/button", () => ({
	Button: ({ children, ...props }: ComponentProps<"button">) => (
		<button {...props}>{children}</button>
	),
}));
mock.module("@/components/ui/input", () => ({
	Input: (props: ComponentProps<"input">) => <input {...props} />,
}));
mock.module("@/components/ui/label", () => ({
	Label: (props: ComponentProps<"label">) => <label {...props} />,
}));
mock.module("@/components/ui/select", () => ({
	Select: ({ children }: { children: ReactNode }) => <div>{children}</div>,
	SelectContent: ({ children }: { children: ReactNode }) => (
		<div>{children}</div>
	),
	SelectItem: ({ children }: { children: ReactNode }) => <div>{children}</div>,
	SelectTrigger: ({ children }: { children: ReactNode }) => (
		<button data-slot="select-trigger">{children}</button>
	),
	SelectValue: () => <span />,
}));
mock.module("@/components/ui/spinner", () => ({
	Spinner: () => <span>Loading</span>,
}));
mock.module("@/components/ui/switch", () => ({
	Switch: ({ size }: { size?: string }) => <span data-size={size} />,
}));
mock.module("@/lib/tauri", () => ({
	api: { mongo: {} },
}));

const { MongoAiAssistant } = await import("./MongoAiAssistant");
const { MongoCatalogSidebar } = await import("./MongoCatalogSidebar");
const { MongoCollectionAdmin } = await import("./MongoCollectionAdmin");
const { MongoDocumentBrowser } = await import("./MongoDocumentBrowser");
const { MongoQueryEditor } = await import("./MongoQueryEditor");

test("uses shared compact controls for MongoDB index administration", () => {
	const markup = renderToStaticMarkup(
		<MongoCollectionAdmin
			uuid="connection-1"
			database="app"
			collection="users"
			view="indexes"
		/>,
	);

	expect(markup).toContain('data-slot="select-trigger"');
	expect(markup).not.toContain("<select");
	expect(markup.match(/data-size="sm"/g) ?? []).toHaveLength(2);
});

test("hides system collections by default and labels them read-only when revealed", () => {
	const controller = {
		catalog: [
			{
				name: "admin",
				collections: [
					{ database: "admin", name: "system.users", is_system: true },
				],
			},
			{
				name: "app",
				collections: [{ database: "app", name: "users", is_system: false }],
			},
		],
		expanded: new Set(["admin", "app"]),
		namespace: { database: "app", collection: "users" },
		showSystemCollections: false,
		savedQueries: [],
		history: [],
		actions: {
			setShowSystemCollections: () => undefined,
			refreshCatalog: async () => undefined,
			toggleDatabase: () => undefined,
			selectCollection: () => undefined,
			loadQuery: () => undefined,
		},
	} as unknown as MongoWorkbenchController;

	const hidden = renderToStaticMarkup(
		<MongoCatalogSidebar
			workbench={controller}
			onCreateCollection={() => undefined}
		/>,
	);
	const revealed = renderToStaticMarkup(
		<MongoCatalogSidebar
			workbench={
				{
					...controller,
					showSystemCollections: true,
				} as MongoWorkbenchController
			}
			onCreateCollection={() => undefined}
		/>,
	);

	expect(hidden).not.toContain("system.users");
	expect(hidden).toContain(">users<");
	expect(revealed).toContain("system.users");
	expect(revealed).toContain("Read-only system collection");
});

test("removes collection mutations from read-only system namespaces", () => {
	const markup = renderToStaticMarkup(
		<MongoCollectionAdmin
			uuid="connection-1"
			database="admin"
			collection="system.users"
			view="indexes"
			readOnly
		/>,
	);

	expect(markup).not.toContain("Create index");
	expect(markup).not.toContain('aria-label="Drop');
});

test("labels generated MongoDB queries as drafts that are not executed", () => {
	const markup = renderToStaticMarkup(
		<MongoAiAssistant
			state={{
				instruction: "Find active users",
				draft: {
					status: "ready",
					sql: '{"version":1,"type":"find"}',
				},
			}}
			configured
			available
			context="Using app.users"
			onInstructionChange={() => undefined}
			onGenerate={() => undefined}
			onUse={() => undefined}
			onDiscard={() => undefined}
		/>,
	);

	expect(markup).toContain("AI query draft");
	expect(markup).toContain("Not executed");
	expect(markup).toContain("Use query");
});

test("bounds the document editor so CodeMirror owns vertical scrolling", () => {
	const markup = renderToStaticMarkup(
		<MongoDocumentBrowser
			workbench={
				{
					namespace: { database: "app", collection: "users" },
					result: null,
					selectedDocument: { _id: 1 },
					loading: false,
					inspector: {
						selectedIndex: 0,
						documentText: '{\n  "_id": 1\n}',
						isNew: false,
					},
					actions: {
						beginDocument: () => undefined,
						deleteDocument: async () => undefined,
						saveDocument: async () => undefined,
						selectDocument: () => undefined,
						setDocumentText: () => undefined,
					},
				} as unknown as MongoWorkbenchController
			}
		/>,
	);

	expect(markup).toContain('class="h-0 min-h-0 flex-1 rounded-none border-0"');
});

test("disables document write controls while a mutation is pending", () => {
	const markup = renderToStaticMarkup(
		<MongoDocumentBrowser
			workbench={
				{
					namespace: { database: "app", collection: "users" },
					result: { documents: [{ _id: 1 }] },
					selectedDocument: { _id: 1 },
					loading: false,
					documentMutating: true,
					canEditDocument: true,
					canMutateSelectedDocument: true,
					inspector: {
						selectedIndex: 0,
						documentText: '{\n  "_id": 1\n}',
						isNew: false,
					},
					actions: {
						beginDocument: () => undefined,
						deleteDocument: async () => undefined,
						saveDocument: async () => undefined,
						selectDocument: () => undefined,
						setDocumentText: () => undefined,
					},
				} as unknown as MongoWorkbenchController
			}
		/>,
	);

	expect(markup.match(/disabled=""/g) ?? []).toHaveLength(3);
});

test("places the run action with the MongoDB query editors", () => {
	const markup = renderToStaticMarkup(
		<MongoQueryEditor
			editor={{
				type: "find",
				filter: "{}",
				projection: "{}",
				sort: "{}",
				limit: 100,
			}}
			onChange={() => undefined}
			onRun={() => undefined}
			loading={false}
			disabled={false}
		/>,
	);

	expect(markup).toContain("Run query");
	expect(markup).toContain('aria-label="Filter JSON"');
});
