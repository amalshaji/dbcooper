import { afterEach, beforeEach, expect, mock, test } from "bun:test";
import { GlobalRegistrator } from "@happy-dom/global-registrator";
import type { Connection } from "../../types/connection";

if (!globalThis.document) GlobalRegistrator.register();

let disconnectCalls: string[] = [];
let connectCalls: string[] = [];
let schemaCalls: string[] = [];
let currentConnection: Connection;
let connectResults: Array<{ status: string; error: string | null }> = [];

const connection: Connection = {
	id: 1,
	uuid: "connection-1",
	type: "postgres",
	name: "Postgres",
	host: "localhost",
	port: 5432,
	database: "app",
	username: "postgres",
	password: "",
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
	created_at: "2026-07-27 00:00:00",
	updated_at: "2026-07-27 00:00:00",
};

mock.module("sonner", () => ({
	toast: {
		error: () => {},
		success: () => {},
	},
}));

mock.module("../../lib/duckdbHelper", () => ({
	prepareDuckDbRuntime: async () => {},
}));

mock.module("../../lib/tauri", () => ({
	api: {
		connections: {
			getByUuid: async () => currentConnection,
		},
		pool: {
			connect: async (uuid: string) => {
				connectCalls.push(uuid);
				return (
					connectResults.shift() ?? {
						status: "connected",
						error: null,
					}
				);
			},
			disconnect: async (uuid: string) => {
				disconnectCalls.push(uuid);
			},
			getSchemaOverview: async (uuid: string) => {
				schemaCalls.push(uuid);
				return {
					tables: [
						{
							schema: "public",
							name: "users",
							type: "table",
							columns: [
								{
									name: "id",
									type: "integer",
									filter_kind: "integer",
									nullable: false,
									default: null,
									primary_key: true,
								},
							],
							foreign_keys: [],
							indexes: [],
						},
					],
					functions: [],
				};
			},
		},
	},
}));

const { act, cleanup, renderHook, waitFor } = await import(
	"@testing-library/react"
);
const { useConnectionLifecycle } = await import("./useConnectionLifecycle");

beforeEach(() => {
	disconnectCalls = [];
	connectCalls = [];
	schemaCalls = [];
	currentConnection = connection;
	connectResults = [{ status: "connected", error: null }];
});

afterEach(cleanup);

test("connects, loads schema atomically, and disconnects on unmount", async () => {
	const navigate = () => {};
	const { result, unmount } = renderHook(() =>
		useConnectionLifecycle({ uuid: connection.uuid, navigate }),
	);

	await waitFor(() => expect(connectCalls).toEqual([connection.uuid]));
	await waitFor(() => expect(schemaCalls).toEqual([connection.uuid]));
	await waitFor(() => expect(result.current.opening.phase).toBe("complete"));

	expect(result.current.connection).toMatchObject({
		value: connection,
		status: "connected",
		hasEverConnected: true,
	});
	expect(result.current.schema).toMatchObject({
		tables: [{ schema: "public", name: "users", type: "table" }],
		tableColumns: { "public.users": [{ name: "id" }] },
		loading: false,
	});
	expect(schemaCalls).toEqual([connection.uuid]);

	unmount();
	expect(disconnectCalls).toEqual([connection.uuid]);
});

test("connects Redis without loading a relational schema", async () => {
	currentConnection = { ...connection, type: "redis", db_type: "redis" };
	const navigate = () => {};
	const { result } = renderHook(() =>
		useConnectionLifecycle({ uuid: connection.uuid, navigate }),
	);

	await waitFor(() => expect(result.current.opening.phase).toBe("complete"));

	expect(result.current.connection.status).toBe("connected");
	expect(schemaCalls).toEqual([]);
});

test("surfaces an initial failure and reconnects through one lifecycle command", async () => {
	connectResults = [
		{ status: "error", error: "database unavailable" },
		{ status: "connected", error: null },
	];
	const navigate = () => {};
	const { result } = renderHook(() =>
		useConnectionLifecycle({ uuid: connection.uuid, navigate }),
	);

	await waitFor(() => expect(result.current.opening.phase).toBe("complete"));
	expect(result.current.connection).toMatchObject({
		status: "disconnected",
		error: "database unavailable",
		hasEverConnected: false,
	});

	await act(async () => result.current.commands.reconnect());
	expect(result.current.connection).toMatchObject({
		status: "connected",
		error: null,
		hasEverConnected: true,
	});
	expect(schemaCalls).toEqual([connection.uuid]);
});
