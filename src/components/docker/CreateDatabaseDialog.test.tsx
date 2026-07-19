import { expect, mock, test } from "bun:test";
import type { ComponentProps, ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { DOCKER_DATABASE_ENGINES } from "../../types/docker";

mock.module("@/components/ui/dialog", () => ({
	Dialog: ({ children }: { children: ReactNode }) => <div>{children}</div>,
	DialogContent: ({ children }: { children: ReactNode }) => <div>{children}</div>,
	DialogDescription: ({ children }: { children: ReactNode }) => (
		<p>{children}</p>
	),
	DialogFooter: ({ children }: { children: ReactNode }) => <div>{children}</div>,
	DialogHeader: ({ children }: { children: ReactNode }) => <div>{children}</div>,
	DialogTitle: ({ children }: { children: ReactNode }) => <h2>{children}</h2>,
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
mock.module("@/components/ui/spinner", () => ({
	Spinner: () => <span>Loading</span>,
}));
mock.module("@/lib/tauri", () => ({
	api: { docker: {} },
	DOCKER_DATABASE_ENGINES,
}));

const { CreateDatabaseDialog } = await import("./CreateDatabaseDialog");

test("explains persistent container behavior before creation", () => {
	const markup = renderToStaticMarkup(
		<CreateDatabaseDialog
			open
			onOpenChange={() => undefined}
			onCreated={async () => undefined}
		/>,
	);

	expect(markup).toContain("Create database");
	expect(markup).toContain("persistent Docker container and volume");
	expect(markup).toContain("Your database and volume remain");
});

test("offers every Docker database engine supported by the backend", () => {
	const markup = renderToStaticMarkup(
		<CreateDatabaseDialog
			open
			onOpenChange={() => undefined}
			onCreated={async () => undefined}
		/>,
	);

	expect(markup).toContain('value="postgres"');
	expect(markup).toContain('value="redis"');
	expect(markup).toContain('value="clickhouse"');
});
