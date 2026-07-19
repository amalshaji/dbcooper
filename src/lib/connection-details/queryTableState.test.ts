import { describe, expect, test } from "bun:test";
import type { QueryTab, TableColumn } from "../../types/tabTypes";
import {
	areCellValuesEqual,
	buildWrappedQuery,
	getPrimaryKeyRowKey,
	isWrappableQuery,
	quoteResultColumn,
	stripLeadingSqlComments,
	stripTrailingSemicolon,
	updateTabById,
} from "./queryTableState";

const column = (name: string, primaryKey = false): TableColumn => ({
	name,
	type: "text",
	filter_kind: "text",
	nullable: true,
	default: null,
	primary_key: primaryKey,
});

const queryTab = (id: string, query: string): QueryTab =>
	({ id, type: "query", title: id, query }) as QueryTab;

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

	test("classifies mutations as non-wrappable", () => {
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

	test("compares cell values using the current JSON deep-value semantics", () => {
		expect(
			areCellValuesEqual(
				{ nested: [1, null, "x"] },
				{ nested: [1, null, "x"] },
			),
		).toBe(true);
		expect(areCellValuesEqual({ a: 1, b: 2 }, { b: 2, a: 1 })).toBe(false);
		expect(areCellValuesEqual(Number.NaN, null)).toBe(true);
	});

	test("updates only the initiating tab and preserves unaffected tab identity", () => {
		const first = queryTab("first", "SELECT 1");
		const second = queryTab("second", "SELECT 2");

		const updated = updateTabById([first, second], "first", { executing: true });

		expect(updated[0]).toEqual({ ...first, executing: true });
		expect(updated[0]).not.toBe(first);
		expect(updated[1]).toBe(second);
	});

	test("does not recreate a tab that was removed before its update arrives", () => {
		const remaining = queryTab("remaining", "SELECT 2");
		const tabs = [remaining];

		const updated = updateTabById(tabs, "removed", { executing: false });

		expect(updated).toEqual([remaining]);
		expect(updated[0]).toBe(remaining);
	});
});
