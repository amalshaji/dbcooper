import { describe, expect, test } from "bun:test";
import {
	getCreateTableDbType,
	getCreateTableTypes,
	isSqlFunction,
} from "./databaseCatalog";

describe("database catalog", () => {
	test("scopes create-table support and type options by engine", () => {
		expect(getCreateTableDbType("postgres")).toBe("postgres");
		expect(getCreateTableDbType("sqlite")).toBe("sqlite");
		expect(getCreateTableDbType("clickhouse")).toBeNull();
		expect(getCreateTableDbType("redis")).toBeNull();
		expect(getCreateTableTypes("postgres")).toContain("JSONB");
		expect(getCreateTableTypes("sqlite")).not.toContain("JSONB");
	});

	test("does not accept another dialect's raw SQL functions", () => {
		expect(isSqlFunction("now()", "postgres")).toBe(true);
		expect(isSqlFunction("today()", "postgres")).toBe(false);
		expect(isSqlFunction("today()", "clickhouse")).toBe(true);
		expect(isSqlFunction("now()", "redis")).toBe(false);
	});
});
