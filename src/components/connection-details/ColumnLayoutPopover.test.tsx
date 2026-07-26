import { describe, expect, mock, test } from "bun:test";
import type { ComponentProps, ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";

mock.module("@/components/ui/button", () => ({
	Button: ({ children, ...props }: ComponentProps<"button">) => (
		<button {...props}>{children}</button>
	),
}));
mock.module("@/components/ui/checkbox", () => ({
	Checkbox: ({
		onCheckedChange: _onCheckedChange,
		...props
	}: ComponentProps<"input"> & {
		onCheckedChange?: (checked: boolean) => void;
	}) => <input type="checkbox" readOnly {...props} />,
}));
mock.module("@/components/ui/popover", () => ({
	Popover: ({ children }: { children: ReactNode }) => <div>{children}</div>,
	PopoverContent: ({ children }: { children: ReactNode }) => (
		<div>{children}</div>
	),
	PopoverDescription: ({ children }: { children: ReactNode }) => (
		<p>{children}</p>
	),
	PopoverHeader: ({ children }: { children: ReactNode }) => <div>{children}</div>,
	PopoverTitle: ({ children }: { children: ReactNode }) => <h2>{children}</h2>,
	PopoverTrigger: ({ children }: { children: ReactNode }) => (
		<div>{children}</div>
	),
}));

const { ColumnLayoutPopover } = await import("./ColumnLayoutPopover");

describe("ColumnLayoutPopover", () => {
	test("renders direct and accessible controls for each column", () => {
		const markup = renderToStaticMarkup(
			<ColumnLayoutPopover
				columns={["id", "name"]}
				layout={{
					columnOrder: ["id", "name"],
					hiddenColumns: [],
					columnWidths: { id: 220 },
				}}
				onChange={() => {}}
			/>,
		);

		expect(markup).toContain("Columns");
		expect(markup).toContain("Drag to reorder");
		expect(markup).toContain('aria-label="Show id column"');
		expect(markup).toContain('aria-label="Move name column up"');
		expect(markup).toContain('aria-label="Move id column down"');
		expect(markup).toContain("Reset columns");
	});
});
