import { describe, expect, test } from "bun:test";
import { isMongoConnection, isSqlConnection } from "./connection";
import type { Connection } from "./connection";

const mongoConnection: Connection = {
	id: 1,
	uuid: "mongo-1",
	type: "mongodb",
	name: "Documents",
	host: "cluster.example.com",
	port: 27017,
	database: "app",
	username: "",
	password: "",
	ssl: 1,
	db_type: "mongodb",
	file_path: null,
	connection_uri: "mongodb+srv://cluster.example.com/app",
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

describe("MongoDB connection routing", () => {
	test("routes MongoDB to its native workspace instead of SQL", () => {
		expect(isMongoConnection(mongoConnection)).toBe(true);
		expect(isSqlConnection(mongoConnection)).toBe(false);
	});
});
