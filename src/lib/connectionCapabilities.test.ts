import { describe, expect, test } from "bun:test";
import {
	getConnectionCapabilities,
	getConnectionDisplayEndpoint,
} from "./connectionCapabilities";
import type { MongoConnection } from "@/types/connection";

describe("connection capabilities", () => {
	test("routes MongoDB through URI-native document behavior", () => {
		expect(getConnectionCapabilities("mongodb")).toEqual({
			label: "MongoDB",
			workspace: "document",
			form: "uri",
			loadsSchema: false,
			fileDatabase: false,
			structuredRowMutations: false,
			defaultPort: 27017,
			testStrategy: "mongo",
		});
	});

	test("owns the native defaults for file databases", () => {
		expect(getConnectionCapabilities("sqlite").defaultPort).toBe(0);
		expect(getConnectionCapabilities("duckdb").defaultPort).toBe(0);
	});

	test("derives the MongoDB display endpoint from its URI", () => {
		const connection: MongoConnection = {
			id: 1,
			uuid: "mongo-1",
			type: "mongodb",
			db_type: "mongodb",
			name: "Documents",
			host: "cluster.example.com",
			port: 27017,
			database: "app",
			username: "user",
			password: "secret",
			ssl: 1,
			file_path: null,
			connection_uri: "mongodb+srv://user:secret@cluster.example.com/app",
			ssh_enabled: 0,
			ssh_host: "",
			ssh_port: 22,
			ssh_user: "",
			ssh_password: "",
			ssh_key_path: "",
			ssh_use_key: 0,
			created_at: "2026-07-28T00:00:00Z",
			updated_at: "2026-07-28T00:00:00Z",
		};

		expect(getConnectionDisplayEndpoint(connection)).toBe(
			"cluster.example.com/app",
		);
	});
});
