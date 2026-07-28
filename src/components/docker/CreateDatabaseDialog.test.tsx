import { expect, mock, test } from "bun:test";
import type { ComponentProps, ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { DOCKER_DATABASE_ENGINES } from "../../types/docker";

const DatabaseIcon = (props: ComponentProps<"svg">) => <svg {...props} />;

mock.module("@/components/icons/clickhouse", () => ({
	ClickhouseIcon: DatabaseIcon,
}));
mock.module("@/components/icons/mariadb", () => ({ MariadbIcon: DatabaseIcon }));
mock.module("@/components/icons/mongodb", () => ({ MongodbIcon: DatabaseIcon }));
mock.module("@/components/icons/mysql", () => ({ MysqlIcon: DatabaseIcon }));
mock.module("@/components/icons/postgres", () => ({
	PostgresqlIcon: DatabaseIcon,
}));
mock.module("@/components/icons/redis", () => ({ RedisIcon: DatabaseIcon }));
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
mock.module("@/components/ui/select", () => ({
	Select: ({ children }: { children: ReactNode }) => <div>{children}</div>,
	SelectContent: ({ children }: { children: ReactNode }) => (
		<div>{children}</div>
	),
	SelectItem: ({
		children,
		value,
	}: {
		children: ReactNode;
		value: string;
	}) => <div data-value={value}>{children}</div>,
	SelectTrigger: ({
		children,
		...props
	}: ComponentProps<"button">) => (
		<button data-slot="select-trigger" {...props}>
			{children}
		</button>
	),
	SelectValue: ({ children }: { children?: ReactNode }) => (
		<span data-slot="select-value">{children}</span>
	),
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

	expect(markup).toContain('data-value="postgres"');
	expect(markup).toContain('data-value="mysql"');
	expect(markup).toContain('data-value="mariadb"');
	expect(markup).toContain('data-value="redis"');
	expect(markup).toContain('data-value="clickhouse"');
	expect(markup).toContain('data-value="mongodb"');
	expect(markup).toContain("MongoDB 7.0");
});

test("shows a decorative database logo for the selected value and every option", () => {
	const markup = renderToStaticMarkup(
		<CreateDatabaseDialog
			open
			onOpenChange={() => undefined}
			onCreated={async () => undefined}
		/>,
	);

	expect(markup.match(/<svg/g) ?? []).toHaveLength(
		DOCKER_DATABASE_ENGINES.length + 1,
	);
	expect(markup.match(/aria-hidden="true"/g) ?? []).toHaveLength(
		DOCKER_DATABASE_ENGINES.length + 1,
	);
});

test("uses the shared select component for the database engine", () => {
	const markup = renderToStaticMarkup(
		<CreateDatabaseDialog
			open
			onOpenChange={() => undefined}
			onCreated={async () => undefined}
		/>,
	);

	expect(markup).toContain('data-slot="select-trigger"');
	expect(markup).not.toContain("<select");
});

test("shows the selected engine display name instead of its stored value", () => {
	const markup = renderToStaticMarkup(
		<CreateDatabaseDialog
			open
			onOpenChange={() => undefined}
			onCreated={async () => undefined}
		/>,
	);

	expect(markup).toContain('<span data-slot="select-value"><svg');
	expect(markup).toContain("PostgreSQL 17</span>");
});
