import { describe, expect, mock, test } from "bun:test";
import type { ColumnDef } from "@tanstack/react-table";
import type { ComponentProps, ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";

mock.module("@/components/ui/button", () => ({
	Button: ({ children, ...props }: ComponentProps<"button">) => (
		<button {...props}>{children}</button>
	),
}));
mock.module("@/components/ui/context-menu", () => ({
	ContextMenu: ({ children }: { children: ReactNode }) => <>{children}</>,
	ContextMenuContent: ({ children }: { children: ReactNode }) => (
		<div>{children}</div>
	),
	ContextMenuItem: ({ children }: { children: ReactNode }) => (
		<div>{children}</div>
	),
	ContextMenuTrigger: ({
		render,
		children,
	}: {
		render: ReactNode;
		children: ReactNode;
	}) => (
		<>
			{render}
			{children}
		</>
	),
}));

const { DataTable } = await import("./DataTable");

interface Row {
	id: number;
	name: string;
}

const columns: ColumnDef<Row>[] = [
	{ accessorKey: "id", header: "ID" },
	{ accessorKey: "name", header: "Name" },
];

describe("DataTable column layout", () => {
	test("renders query results without a saved column layout", () => {
		const markup = renderToStaticMarkup(
			<DataTable
				data={[{ id: 1, name: "Ada" }]}
				columns={columns}
				hidePagination
			/>,
		);

		expect(markup).toContain(">ID<");
		expect(markup).toContain(">Name<");
		expect(markup).toContain(">Ada<");
	});

	test("renders controlled order, visibility, width, and an accessible resize handle", () => {
		const markup = renderToStaticMarkup(
			<DataTable
				data={[{ id: 1, name: "Ada" }]}
				columns={columns}
				hidePagination
				columnLayout={{
					columnOrder: ["name", "id"],
					hiddenColumns: ["name"],
					columnWidths: { id: 220 },
				}}
				onColumnLayoutChange={() => {}}
			/>,
		);

		expect(markup).toContain(">ID<");
		expect(markup).not.toContain(">Name<");
		expect(markup).toContain("width:220px");
		expect(markup).toContain('role="separator"');
		expect(markup).toContain('aria-label="Resize ID column"');
	});
});
