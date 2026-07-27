import { expect, mock, test } from "bun:test";
import type { ComponentProps } from "react";
import { renderToStaticMarkup } from "react-dom/server";

mock.module("@/components/ui/button", () => ({
	Button: ({ children, ...props }: ComponentProps<"button">) => (
		<button {...props}>{children}</button>
	),
}));

const { EmptyState } = await import("./EmptyState");

test("renders action icons alongside their labels", () => {
	const markup = renderToStaticMarkup(
		<EmptyState
			title="No connections yet"
			description="Create a connection."
			actions={[
				{
					label: "Create database",
					icon: <svg data-testid="create-database-icon" />,
					onClick: () => undefined,
				},
			]}
		/>,
	);

	expect(markup).toContain('data-testid="create-database-icon"');
	expect(markup).toContain("Create database");
});
