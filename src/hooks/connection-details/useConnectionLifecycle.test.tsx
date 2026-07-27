import { afterEach, beforeEach, expect, mock, test } from "bun:test";
import { GlobalRegistrator } from "@happy-dom/global-registrator";
import type { Connection } from "../../types/connection";

if (!globalThis.document) GlobalRegistrator.register();

let disconnectCalls: string[] = [];
let connectCalls: string[] = [];
let schemaCalls: string[] = [];

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
			getByUuid: async () => connection,
		},
		pool: {
			connect: async (uuid: string) => {
				connectCalls.push(uuid);
				return { status: "connected", error: null };
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

const { cleanup, renderHook, waitFor } = await import("@testing-library/react");
const { useConnectionLifecycle } = await import("./useConnectionLifecycle");

beforeEach(() => {
	disconnectCalls = [];
	connectCalls = [];
	schemaCalls = [];
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
