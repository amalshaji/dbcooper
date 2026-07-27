import { describe, expect, mock, test } from "bun:test";
import type { ComponentProps, ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";

mock.module("@/components/SqlEditor", () => ({
	SqlEditor: () => <div data-testid="sql-editor" />,
}));
mock.module("@/components/DataTable", () => ({
	DataTable: () => <div data-testid="data-table" />,
}));
mock.module("@/components/ui/button", () => ({
	Button: ({ children, ...props }: ComponentProps<"button">) => (
		<button {...props}>{children}</button>
	),
}));
mock.module("@/components/ui/card", () => ({
	Card: ({ children, ...props }: ComponentProps<"div">) => (
		<div {...props}>{children}</div>
	),
	CardContent: ({ children, ...props }: ComponentProps<"div">) => (
		<div {...props}>{children}</div>
	),
	CardDescription: ({ children, ...props }: ComponentProps<"p">) => (
		<p {...props}>{children}</p>
	),
	CardHeader: ({ children, ...props }: ComponentProps<"div">) => (
		<div data-slot="card-header" {...props}>
			{children}
		</div>
	),
	CardTitle: ({ children, ...props }: ComponentProps<"h3">) => (
		<h3 {...props}>{children}</h3>
	),
}));
mock.module("@/components/ui/input", () => ({
	Input: (props: ComponentProps<"input">) => <input {...props} />,
}));
mock.module("@/components/ui/skeleton", () => ({
	Skeleton: (props: ComponentProps<"div">) => <div {...props} />,
}));
mock.module("@/components/ui/spinner", () => ({
	Spinner: () => <span data-testid="spinner" />,
}));
mock.module("@/components/ui/dropdown-menu", () => ({
	DropdownMenu: ({ children }: { children: ReactNode }) => <>{children}</>,
	DropdownMenuContent: ({ children }: { children: ReactNode }) => (
		<div>{children}</div>
	),
	DropdownMenuItem: ({ children }: { children: ReactNode }) => (
		<div>{children}</div>
	),
	DropdownMenuSeparator: () => <hr />,
	DropdownMenuSub: ({ children }: { children: ReactNode }) => <>{children}</>,
	DropdownMenuSubContent: ({ children }: { children: ReactNode }) => (
		<div>{children}</div>
	),
	DropdownMenuSubTrigger: ({ children }: { children: ReactNode }) => (
		<div>{children}</div>
	),
	DropdownMenuTrigger: ({ render }: { render: ReactNode }) => render,
}));
mock.module("@/lib/databaseCapabilities", () => ({
	getSqlFormatterLanguage: () => "postgresql",
}));

const { QueryWorkspace } = await import(
	"../components/connection-details/QueryWorkspace"
);

const connection = {
	type: "postgres",
	db_type: "postgres",
} as never;

const tab = {
	id: "query-test",
	type: "query",
	title: "New Query",
	query: "SELECT 1",
	ai: { instruction: "", draft: { status: "idle" } },
	savedQueryId: null,
	savedQueryName: null,
	results: null,
	error: null,
	success: false,
	executionTime: null,
	affectedRows: null,
	executing: false,
	filterInput: "",
	filter: "",
	sort: null,
	resultBaseQuery: null,
} as never;

function renderQueryWorkspace() {
	return renderToStaticMarkup(
		<QueryWorkspace
			tab={tab}
			connection={connection}
			tables={[]}
			tableColumns={{}}
			queryColumns={[]}
			showSaveDialog={false}
			saveQueryName=""
			setSaveQueryName={() => {}}
			setShowSaveDialog={() => {}}
			handleSaveQuery={() => {}}
			handleQueryChange={() => {}}
			handleRunQuery={() => {}}
			handleRunAllQueries={() => {}}
			getEditorAiProps={() => undefined}
			setCursorLine={() => {}}
			setCursorChar={() => {}}
			handleCopyQueryError={() => {}}
			handleExportCSV={() => {}}
			handleQueryFilterInputChange={() => {}}
			handleApplyQueryFilter={() => {}}
			handleClearFilter={() => {}}
			handleQuerySortChange={() => {}}
			setSelectedQueryRow={() => {}}
			setQueryResultSheetOpen={() => {}}
		/>,
	);
}

describe("ConnectionDetails query layout", () => {
	test("lets the cards own the section header top padding", () => {
		const markup = renderQueryWorkspace();

		for (const title of ["SQL editor", "Query results"]) {
			const titleIndex = markup.indexOf(title);
			expect(titleIndex).toBeGreaterThan(-1);
			const headerIndex = markup.lastIndexOf(
				'data-slot="card-header"',
				titleIndex,
			);
			const headerEnd = markup.indexOf(">", headerIndex);
			const openingTag = markup.slice(headerIndex, headerEnd + 1);
			expect(openingTag).not.toContain("pt-4");
			expect(openingTag).not.toContain("py-4");
		}
	});
});
