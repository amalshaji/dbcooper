import { describe, expect, mock, test } from "bun:test";
import type { ComponentProps, ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import type { TableFilterState } from "../../lib/resultFilters";
import * as resultFilters from "../../lib/resultFilters";
import type { TableColumn } from "../../types/tabTypes";

mock.module("@/lib/resultFilters", () => resultFilters);
mock.module("@/components/ui/button", () => ({
	Button: ({
		children,
		variant: _variant,
		size: _size,
		...props
	}: ComponentProps<"button"> & { variant?: string; size?: string }) => (
		<button {...props}>{children}</button>
	),
}));
mock.module("@/components/ui/input", () => ({
	Input: (props: ComponentProps<"input">) => <input {...props} />,
}));
mock.module("@/components/ui/select", () => ({
	Select: ({ children }: { children: ReactNode }) => <div>{children}</div>,
	SelectContent: ({ children }: { children: ReactNode }) => (
		<div>{children}</div>
	),
	SelectItem: ({ children }: { children: ReactNode }) => <div>{children}</div>,
	SelectTrigger: ({
		children,
		size: _size,
		...props
	}: ComponentProps<"button"> & { size?: string }) => (
		<button {...props}>{children}</button>
	),
	SelectValue: () => null,
}));

const { TableFilterBar } = await import("./TableFilterBar");

const columns: TableColumn[] = [
	{
		name: "name",
		type: "text",
		filter_kind: "text",
		nullable: false,
		default: null,
		primary_key: false,
	},
];

const noop = () => {};

function renderFilterBar(state: TableFilterState): string {
	return renderToStaticMarkup(
		<TableFilterBar
			state={state}
			columns={columns}
			loading={false}
			onStateChange={noop}
			onApply={noop}
			onClear={noop}
		/>,
	);
}

describe("TableFilterBar", () => {
	test("keeps the editor rendered when an active filter returns no rows", () => {
		const filter = {
			kind: "structured" as const,
			value: {
				conjunction: "and" as const,
				conditions: [
					{ column: "name", operator: "contains" as const, value: "missing" },
				],
			},
		};

		const markup = renderFilterBar({ draft: filter, applied: filter });

		expect(markup).toContain("Builder");
		expect(markup).toContain("Advanced");
		expect(markup).toContain('aria-pressed="true"');
		expect(markup).toContain("bg-background text-foreground shadow-sm");
		expect(markup).toContain("Apply filter");
		expect(markup).toContain("Active:");
		expect(markup).toContain("name contains missing");
	});

	test("disables stale filter conditions instead of using another column type", () => {
		const markup = renderFilterBar({
			draft: {
				kind: "structured",
				value: {
					conjunction: "and",
					conditions: [
						{ column: "removed", operator: "contains", value: "value" },
					],
				},
			},
			applied: null,
		});

		const applyButton = markup.match(
			/<button[^>]*disabled=""[^>]*>Apply filter<\/button>/,
		);
		expect(applyButton).not.toBeNull();
		expect(markup).not.toContain("Filter value for name");
	});
});
