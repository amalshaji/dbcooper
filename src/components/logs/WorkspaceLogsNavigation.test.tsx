import { afterEach, describe, expect, mock, test } from "bun:test";
import { GlobalRegistrator } from "@happy-dom/global-registrator";
import type { ComponentProps } from "react";

if (!globalThis.document) GlobalRegistrator.register();

const { useEffect } = await import("react");
const { cleanup, fireEvent, render, screen } = await import(
	"@testing-library/react"
);
const utils = await import("../../lib/utils");
mock.module("@/lib/utils", () => utils);
mock.module("@/components/ui/button", () => ({
	Button: ({ children, ...props }: ComponentProps<"button">) => (
		<button {...props}>{children}</button>
	),
}));

let mounts = 0;
let unmounts = 0;
mock.module("./LogsWorkspace", () => ({
	LogsWorkspace: () => {
		useEffect(() => {
			mounts += 1;
			return () => {
				unmounts += 1;
			};
		}, []);
		return <div>Live logs workspace</div>;
	},
}));

const { WorkspaceLogsNavigation } = await import("./WorkspaceLogsNavigation");

const connection = {
	id: 1,
	uuid: "redis-1",
	name: "Redis",
	type: "redis",
	db_type: "redis",
	created_at: "",
	updated_at: "",
	host: "localhost",
	port: 6379,
	database: "0",
	username: "",
	password: "",
	ssl: 0,
	file_path: null,
	ssh_enabled: 0,
	ssh_host: "",
	ssh_port: 22,
	ssh_user: "",
	ssh_password: "",
	ssh_key_path: "",
	ssh_use_key: 0,
	connection_uri: null,
} as const;

afterEach(() => {
	cleanup();
	mounts = 0;
	unmounts = 0;
});

describe("WorkspaceLogsNavigation", () => {
	test("gives the primary workspace a full-height column layout", () => {
		render(
			<WorkspaceLogsNavigation connection={connection} workspaceLabel="Keys">
				<div>Redis keys</div>
			</WorkspaceLogsNavigation>,
		);

		const workspace = screen.getByText("Redis keys").parentElement;
		expect(workspace?.classList.contains("flex")).toBe(true);
		expect(workspace?.classList.contains("flex-col")).toBe(true);
	});

	test("mounts one Logs workspace and unmounts it when another view is selected", () => {
		render(
			<WorkspaceLogsNavigation connection={connection} workspaceLabel="Keys">
				<div>Redis keys</div>
			</WorkspaceLogsNavigation>,
		);

		fireEvent.click(screen.getByRole("button", { name: "Open logs" }));
		expect(mounts).toBe(1);
		expect(screen.getAllByText("Live logs workspace")).toHaveLength(1);

		fireEvent.click(screen.getByRole("button", { name: "Keys" }));
		expect(unmounts).toBe(1);
		expect(screen.queryByText("Live logs workspace")).toBeNull();
	});

	test("unmounts and removes the Logs workspace when its tab closes", () => {
		render(
			<WorkspaceLogsNavigation connection={connection} workspaceLabel="Keys">
				<div>Redis keys</div>
			</WorkspaceLogsNavigation>,
		);

		fireEvent.click(screen.getByRole("button", { name: "Open logs" }));
		fireEvent.click(screen.getByRole("button", { name: "Close Logs" }));

		expect(unmounts).toBe(1);
		expect(screen.getByRole("button", { name: "Open logs" })).toBeTruthy();
	});
});
