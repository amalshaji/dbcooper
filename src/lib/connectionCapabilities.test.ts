import { describe, expect, test } from "bun:test";
import {
	getConnectionCapabilities,
	getConnectionDisplayEndpoint,
} from "./connectionCapabilities";
import type { MongoConnection } from "@/types/connection";

describe("connection capabilities", () => {
	test("routes MongoDB through URI-native document behavior", () => {
		expect(getConnectionCapabilities("mongodb")).toEqual({
			workspace: "document",
			form: "uri",
			loadsSchema: false,
			fileDatabase: false,
			structuredRowMutations: false,
			defaultPort: 27017,
		});
	});

	test("derives the MongoDB display endpoint from its URI", () => {
		const connection: MongoConnection = {
			id: 1,
			uuid: "mongo-1",
			type: "mongodb",
			db_type: "mongodb",
			name: "Documents",
			connection_uri: "mongodb+srv://user:secret@cluster.example.com/app",
			created_at: "2026-07-28T00:00:00Z",
			updated_at: "2026-07-28T00:00:00Z",
		};

		expect(getConnectionDisplayEndpoint(connection)).toBe(
			"cluster.example.com/app",
		);
	});
});
