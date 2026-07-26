import { describe, expect, test } from "bun:test";
import {
	getCreateTableDbType,
	getCreateTableTypes,
	getDatabaseLabel,
	getSuggestedFunctions,
	isSqlFunction,
} from "./databaseCatalog";

describe("database catalog", () => {
	test("scopes create-table support and type options by engine", () => {
		expect(getCreateTableDbType("postgres")).toBe("postgres");
		expect(getCreateTableDbType("sqlite")).toBe("sqlite");
		expect(getCreateTableDbType("mysql")).toBe("mysql");
		expect(getCreateTableDbType("mariadb")).toBe("mariadb");
		expect(getCreateTableDbType("clickhouse")).toBeNull();
		expect(getCreateTableDbType("duckdb")).toBeNull();
		expect(getCreateTableDbType("redis")).toBeNull();
		expect(getCreateTableTypes("postgres")).toContain("JSONB");
		expect(getCreateTableTypes("sqlite")).not.toContain("JSONB");
		expect(getCreateTableTypes("mysql")).toContain("BIGINT");
	});

	test("provides DuckDB query expressions without enabling table creation", () => {
		expect(getDatabaseLabel("duckdb")).toBe("DuckDB");
		expect(getSuggestedFunctions("duckdb", "TIMESTAMP")).toContain(
			"current_timestamp",
		);
		expect(isSqlFunction("uuid()", "duckdb")).toBe(true);
	});

	test("does not accept another dialect's raw SQL functions", () => {
		expect(isSqlFunction("now()", "postgres")).toBe(true);
		expect(isSqlFunction("today()", "postgres")).toBe(false);
		expect(isSqlFunction("today()", "clickhouse")).toBe(true);
		expect(isSqlFunction("now()", "redis")).toBe(false);
	});
});
