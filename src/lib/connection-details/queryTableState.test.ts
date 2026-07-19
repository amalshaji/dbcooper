import { describe, expect, test } from "bun:test";
import type { TableColumn } from "../../types/tabTypes";
import {
	areCellValuesEqual,
	buildWrappedQuery,
	getPrimaryKeyRowKey,
	isWrappableQuery,
	quoteResultColumn,
	stripLeadingSqlComments,
	stripTrailingSemicolon,
} from "./queryTableState";

const column = (name: string, primaryKey = false): TableColumn => ({
	name,
	type: "text",
	filter_kind: "text",
	nullable: true,
	default: null,
	primary_key: primaryKey,
});

describe("connection details query and table state", () => {
	test("strips leading comments and the trailing semicolon before wrapping a query", () => {
		const query = "  -- context\n/* generated */\nSELECT * FROM users;  ";

		expect(stripLeadingSqlComments(query)).toBe("SELECT * FROM users;  ");
		expect(stripTrailingSemicolon(query)).toBe(
			"-- context\n/* generated */\nSELECT * FROM users",
		);
		expect(isWrappableQuery(query)).toBe(true);
		expect(buildWrappedQuery(query, " active = true ", null)).toBe(
			"WITH user_query AS (\n-- context\n/* generated */\nSELECT * FROM users\n)\nSELECT * FROM user_query WHERE active = true;",
		);
	});

	test("escapes result sort columns for Postgres, SQLite, and ClickHouse", () => {
		expect(quoteResultColumn('display"name', "postgres")).toBe(
			'"display""name"',
		);
		expect(quoteResultColumn('display"name', "sqlite")).toBe(
			'"display""name"',
		);
		expect(quoteResultColumn("display`name", "clickhouse")).toBe(
			"`display``name`",
		);
		expect(
			buildWrappedQuery("SELECT 1", "", {
				column: "total`value",
				direction: "desc",
			}, "clickhouse"),
		).toContain("ORDER BY `total``value` DESC");
	});

	test("classifies SELECT, WITH, and VALUES queries as wrappable", () => {
		for (const query of [
			"SELECT * FROM users",
			"WITH active_users AS (SELECT * FROM users) SELECT * FROM active_users",
			"VALUES (1), (2)",
		]) {
			expect(isWrappableQuery(query)).toBe(true);
		}
	});

	test("classifies mutation statement keywords as non-wrappable", () => {
		for (const query of [
			"INSERT INTO users VALUES (1)",
			"UPDATE users SET active = true",
			"DELETE FROM users",
			"/* reason */ DROP TABLE users",
		]) {
			expect(isWrappableQuery(query)).toBe(false);
		}
	});

	test("builds stable primary-key identity for composite, null, and special values", () => {
		const columns = [column("tenant/id", true), column("record\"key", true)];

		expect(
			getPrimaryKeyRowKey(
				{ "tenant/id": null, 'record"key': "line\n[1],comma" },
				columns,
			),
		).toBe('[["tenant/id",null],["record\\"key","line\\n[1],comma"]]');
		expect(getPrimaryKeyRowKey({ id: 1 }, [column("id")])).toBeNull();
	});

	test("compares supported JSON-safe cell values", () => {
		expect(
			areCellValuesEqual(
				{ nested: [1, null, { value: "x" }] },
				{ nested: [1, null, { value: "x" }] },
			),
		).toBe(true);
		expect(
			areCellValuesEqual(
				{ nested: [1, { value: "x" }] },
				{ nested: [1, { value: "changed" }] },
			),
		).toBe(false);
		expect(areCellValuesEqual("before", "after")).toBe(false);
	});
});
