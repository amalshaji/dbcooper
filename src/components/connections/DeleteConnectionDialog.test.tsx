import { expect, mock, test } from "bun:test";
import type { ComponentProps, ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import type { Connection } from "@/lib/tauri";

mock.module("@/components/ui/alert-dialog", () => ({
	AlertDialog: ({ children }: { children: ReactNode }) => <div>{children}</div>,
	AlertDialogAction: ({ children, ...props }: ComponentProps<"button">) => (
		<button {...props}>{children}</button>
	),
	AlertDialogCancel: ({ children, ...props }: ComponentProps<"button">) => (
		<button {...props}>{children}</button>
	),
	AlertDialogContent: ({ children }: { children: ReactNode }) => (
		<div>{children}</div>
	),
	AlertDialogDescription: ({ children }: { children: ReactNode }) => (
		<p>{children}</p>
	),
	AlertDialogFooter: ({ children }: { children: ReactNode }) => (
		<div>{children}</div>
	),
	AlertDialogHeader: ({ children }: { children: ReactNode }) => (
		<div>{children}</div>
	),
	AlertDialogTitle: ({ children }: { children: ReactNode }) => (
		<h2>{children}</h2>
	),
}));
mock.module("@/components/ui/checkbox", () => ({
	Checkbox: ({
		checked,
		...props
	}: ComponentProps<"input"> & { checked?: boolean }) => (
		<input type="checkbox" defaultChecked={checked} {...props} />
	),
}));
mock.module("@/components/ui/spinner", () => ({
	Spinner: () => <span>Loading</span>,
}));

const { DeleteConnectionDialog } = await import("./DeleteConnectionDialog");

const connection: Connection = {
	id: 1,
	uuid: "connection",
	type: "postgres",
	name: "Local Postgres",
	host: "127.0.0.1",
	port: 5432,
	database: "postgres",
	username: "postgres",
	password: "secret",
	ssl: 0,
	db_type: "postgres",
	file_path: null,
	ssh_enabled: 0,
	ssh_host: "",
	ssh_port: 22,
	ssh_user: "",
	ssh_password: "",
	ssh_key_path: "",
	ssh_use_key: 0,
	created_at: "2026-07-20",
	updated_at: "2026-07-20",
};

test("aligns the Docker delete checkbox with the first label line", () => {
	const markup = renderToStaticMarkup(
		<DeleteConnectionDialog
			connection={connection}
			dockerState={{
				connection_uuid: "connection",
				ownership: "created",
				container_name: "container",
				status: "running",
			}}
			deleteDockerData={false}
			deleting={false}
			onDeleteDockerDataChange={() => undefined}
			onCancel={() => undefined}
			onConfirm={() => undefined}
		/>,
	);

	expect(markup).toContain('class="mt-0.5"');
	expect(markup).toContain(
		"Also delete the Docker container and its data volume",
	);
});
