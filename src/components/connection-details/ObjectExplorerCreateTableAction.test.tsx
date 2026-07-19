import { describe, expect, mock, test } from "bun:test";
import type { ComponentProps } from "react";
import { renderToStaticMarkup } from "react-dom/server";

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

const { ObjectExplorerCreateTableAction } = await import(
	"./ObjectExplorerCreateTableAction"
);

describe("ObjectExplorerCreateTableAction", () => {
	test("renders for an empty supported database", () => {
		const markup = renderToStaticMarkup(
			<ObjectExplorerCreateTableAction
				visible
				onCreateTable={() => {}}
			/>,
		);

		expect(markup).toContain("Create table");
	});

	test("is hidden for unsupported database engines", () => {
		const markup = renderToStaticMarkup(
			<ObjectExplorerCreateTableAction
				visible={false}
				onCreateTable={() => {}}
			/>,
		);

		expect(markup).toBe("");
	});
});
