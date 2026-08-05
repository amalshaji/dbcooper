import { expect, test } from "bun:test";
import type { Connection, ConnectionFormData } from "@/types/connection";
import {
	connectionToFormData,
	mergeD1ConnectionFields,
} from "./connectionFormState";

test("merges D1 field changes into the latest form state", () => {
	const initial: ConnectionFormData = {
		type: "d1",
		name: "Production",
		host: "api.cloudflare.com",
		port: 443,
		database: "old-database",
		username: "old-account",
		password: "old-token",
		ssl: true,
	};

	const withAccount = mergeD1ConnectionFields(initial, {
		accountId: "new-account",
		databaseId: "",
	});
	const withToken = mergeD1ConnectionFields(withAccount, {
		apiToken: "new-token",
		databaseId: "",
	});

	expect(withToken.username).toBe("new-account");
	expect(withToken.password).toBe("new-token");
	expect(withToken.database).toBe("");
});

test("preserves hidden managed MongoDB credentials when preparing an edit", () => {
	const connection: Connection = {
		id: 1,
		uuid: "mongo-1",
		type: "mongodb",
		name: "Local MongoDB",
		host: "127.0.0.1",
		port: 27017,
		database: "dbcooper",
		username: "dbcooper",
		password: "secret",
		ssl: 0,
		db_type: "mongodb",
		file_path: null,
		connection_uri: "mongodb://dbcooper:secret@127.0.0.1:27017/dbcooper",
		ssh_enabled: 0,
		ssh_host: "",
		ssh_port: 22,
		ssh_user: "",
		ssh_password: "",
		ssh_key_path: "",
		ssh_use_key: 0,
		created_at: "2026-08-05T00:00:00Z",
		updated_at: "2026-08-05T00:00:00Z",
	};

	expect(connectionToFormData(connection)).toMatchObject({
		type: "mongodb",
		host: "127.0.0.1",
		port: 27017,
		database: "dbcooper",
		username: "dbcooper",
		password: "secret",
		connection_uri: connection.connection_uri,
	});
});
