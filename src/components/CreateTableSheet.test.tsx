import { describe, expect, mock, test } from "bun:test";
import type { ComponentProps, ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";

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
mock.module("@/components/ui/sheet", () => ({
	Sheet: ({ children }: { children: ReactNode }) => <div>{children}</div>,
	SheetContent: ({ children }: { children: ReactNode }) => <div>{children}</div>,
	SheetDescription: ({ children }: { children: ReactNode }) => (
		<p>{children}</p>
	),
	SheetFooter: ({ children }: { children: ReactNode }) => <div>{children}</div>,
	SheetHeader: ({ children }: { children: ReactNode }) => <div>{children}</div>,
	SheetTitle: ({ children }: { children: ReactNode }) => <h2>{children}</h2>,
}));
mock.module("@/components/ui/select", () => ({
	Select: ({ children }: { children: ReactNode }) => <div>{children}</div>,
	SelectContent: ({ children }: { children: ReactNode }) => (
		<div>{children}</div>
	),
	SelectItem: ({ children }: { children: ReactNode }) => <div>{children}</div>,
	SelectTrigger: ({ children }: { children: ReactNode }) => (
		<button type="button">{children}</button>
	),
	SelectValue: () => null,
}));
mock.module("@/components/ui/switch", () => ({
	Switch: ({
		checked,
		onCheckedChange: _onCheckedChange,
		size: _size,
		...props
	}: ComponentProps<"input"> & {
		onCheckedChange?: (checked: boolean) => void;
		size?: string;
	}) => <input type="checkbox" defaultChecked={checked} {...props} />,
}));
mock.module("@/components/ui/spinner", () => ({
	Spinner: () => <span data-testid="spinner" />,
}));

const { CreateTableActionButton, CreateTableSheet } = await import(
	"./CreateTableSheet"
);
const { CreateTableReview } = await import("./CreateTableReview");

describe("CreateTableSheet", () => {
	test("renders the initial SQLite definition step", () => {
		const markup = renderToStaticMarkup(
			<CreateTableSheet
				open
				dbType="sqlite"
				initialSchema="main"
				availableSchemas={[]}
				onOpenChange={() => {}}
				onPreview={async () => ""}
				onCreate={async () => ({
					schema: "main",
					name: "events",
					type: "table",
				})}
				onCreated={() => {}}
			/>,
		);

		expect(markup).toContain("Create table");
		expect(markup).toContain("Table name");
		expect(markup).toContain('value="main"');
		expect(markup).toContain("Column name");
		expect(markup).toContain('aria-label="Primary key"');
		expect(markup).toContain("Review SQL");
	});

	test("keeps the Create table label while submitting", () => {
		const markup = renderToStaticMarkup(
			<CreateTableActionButton creating onClick={() => {}} />,
		);

		expect(markup).toContain('data-testid="spinner"');
		expect(markup).toContain("Create table");
	});

	test("renders the generated SQL review with an accessible label", () => {
		const markup = renderToStaticMarkup(
			<CreateTableReview sql={'CREATE TABLE "main"."events" ("id" INTEGER);'} />,
		);

		expect(markup).toContain('aria-label="Generated SQL"');
		expect(markup).toContain("CREATE TABLE");
		expect(markup).toContain("regenerated from the definition");
	});
});
