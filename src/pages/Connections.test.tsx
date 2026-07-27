import { afterEach, expect, mock, test } from "bun:test";
import { GlobalRegistrator } from "@happy-dom/global-registrator";
import type { ComponentProps, ReactNode } from "react";
import type { Connection } from "../lib/tauri";
import {
	DOCKER_DATABASE_ENGINES,
	type DockerConnectionState,
} from "../types/docker";

if (!globalThis.document) GlobalRegistrator.register();

const pending = <T,>() => new Promise<T>(() => {});

let listConnections: () => Promise<Connection[]> = () => pending();
let listDockerStates: () => Promise<DockerConnectionState[]> = () => pending();

mock.module("@tauri-apps/plugin-dialog", () => ({
	open: async () => null,
	save: async () => null,
}));
mock.module("@tauri-apps/plugin-fs", () => ({
	readTextFile: async () => "",
	writeTextFile: async () => undefined,
}));
mock.module("@tauri-apps/plugin-opener", () => ({
	revealItemInDir: async () => undefined,
}));
mock.module("sonner", () => ({
	toast: {
		error: () => undefined,
		success: () => undefined,
		warning: () => undefined,
	},
}));
mock.module("@/components/ConnectionForm", () => ({
	ConnectionForm: () => null,
}));
mock.module("@/components/connections/ConnectionCard", () => ({
	ConnectionCard: ({ connection }: { connection: Connection }) => (
		<div>{connection.name}</div>
	),
	ConnectionCardSkeleton: () => (
		<div data-slot="connection-card-skeleton" aria-hidden="true" />
	),
}));
mock.module("@/components/UpdateChecker", () => ({
	UpdateChecker: () => null,
}));
mock.module("@/components/connections/DeleteConnectionDialog", () => ({
	DeleteConnectionDialog: () => null,
}));
mock.module("@/components/docker/ConnectDockerDialog", () => ({
	ConnectDockerDialog: () => null,
}));
mock.module("@/components/docker/CreateDatabaseDialog", () => ({
	CreateDatabaseDialog: () => null,
}));
mock.module("@/components/EmptyState", () => ({
	EmptyState: ({
		title,
		actions,
	}: {
		title: string;
		actions: Array<{ label: string }>;
	}) => (
		<div>
			<h2>{title}</h2>
			{actions.map((action) => (
				<button type="button" key={action.label}>
					{action.label}
				</button>
			))}
		</div>
	),
}));
mock.module("@/components/ui/badge", () => ({
	Badge: ({ children }: { children: ReactNode }) => <span>{children}</span>,
}));
mock.module("@/components/ui/button", () => ({
	Button: ({ children, ...props }: ComponentProps<"button">) => (
		<button {...props}>{children}</button>
	),
}));
mock.module("@/components/ui/skeleton", () => ({
	Skeleton: ({ className, ...props }: ComponentProps<"div">) => (
		<div data-slot="skeleton" className={className} {...props} />
	),
}));
mock.module("@/lib/tauri", () => ({
	DOCKER_DATABASE_ENGINES,
	api: {
		connections: {
			list: () => listConnections(),
		},
		docker: {
			states: () => listDockerStates(),
		},
	},
}));

const { cleanup, render, screen } = await import("@testing-library/react");
const { MemoryRouter } = await import("react-router-dom");
const { Connections } = await import("./Connections");

afterEach(() => {
	cleanup();
	listConnections = () => pending();
	listDockerStates = () => pending();
});

function renderConnections() {
	return render(
		<MemoryRouter>
			<Connections />
		</MemoryRouter>,
	);
}

test("keeps the page shell interactive while connections load", () => {
	renderConnections();

	expect(screen.getByRole("heading", { name: "Connections" })).not.toBeNull();
	expect(
		screen.getByRole("heading", { name: "Your databases" }),
	).not.toBeNull();
	expect(
		screen.getByRole("status", { name: "Loading connections" }),
	).not.toBeNull();
	expect(
		document.querySelectorAll('[data-slot="connection-card-skeleton"]'),
	).toHaveLength(4);

	for (const name of [
		"Connect Docker",
		"Create database",
		"Import",
		"New connection",
	]) {
		expect(
			(screen.getByRole("button", { name }) as HTMLButtonElement).disabled,
		).toBe(false);
	}
});

test("shows the existing empty state after loading finishes", async () => {
	listConnections = async () => [];
	listDockerStates = async () => [];

	renderConnections();

	expect(await screen.findByText("No connections yet")).not.toBeNull();
	expect(
		screen.queryByRole("status", { name: "Loading connections" }),
	).toBeNull();
	expect(
		screen.getByRole("button", { name: "Create database" }),
	).not.toBeNull();
	expect(screen.getByRole("button", { name: "Connect Docker" })).not.toBeNull();
	expect(screen.getByRole("button", { name: "New connection" })).not.toBeNull();
});
