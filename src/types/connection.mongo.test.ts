import { describe, expect, test } from "bun:test";
import { isMongoConnection, isSqlConnection } from "./connection";
import type { Connection } from "./connection";

const mongoConnection: Connection = {
	id: 1,
	uuid: "mongo-1",
	type: "mongodb",
	name: "Documents",
	db_type: "mongodb",
	connection_uri: "mongodb+srv://cluster.example.com/app",
	created_at: "2026-07-28T00:00:00Z",
	updated_at: "2026-07-28T00:00:00Z",
};

describe("MongoDB connection routing", () => {
	test("routes MongoDB to its native workspace instead of SQL", () => {
		expect(isMongoConnection(mongoConnection)).toBe(true);
		expect(isSqlConnection(mongoConnection)).toBe(false);
	});
});
