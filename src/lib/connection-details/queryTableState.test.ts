import { describe, expect, test } from "bun:test";
import type { TableColumn } from "@/types/tabTypes";
import {
	areCellValuesEqual,
	buildWrappedQuery,
	getPrimaryKeyRowKey,
	isWrappableQuery,
	quoteResultColumn,
	serializeRowsToCsv,
} from "./queryTableState";

describe("connection details query state", () => {
	test("recognizes every supported read-style DuckDB statement", () => {
		for (const keyword of [
			"SELECT",
			"WITH",
			"VALUES",
			"FROM",
			"SUMMARIZE",
			"PIVOT",
			"UNPIVOT",
		]) {
			expect(isWrappableQuery(`-- context\n${keyword} source`)).toBe(true);
		}
		expect(isWrappableQuery("UPDATE source SET value = 1")).toBe(false);
	});

	test("quotes result columns for each engine family", () => {
		for (const dbType of ["clickhouse", "mysql", "mariadb"]) {
			expect(quoteResultColumn("a`b", dbType)).toBe("`a``b`");
		}
		for (const dbType of ["postgres", "sqlite", "duckdb", "d1"]) {
			expect(quoteResultColumn('a"b', dbType)).toBe('"a""b"');
		}
	});

	test("wraps filters and sorting around the original query", () => {
		expect(
			buildWrappedQuery("SELECT * FROM users;", "active = true", {
				column: "created_at",
				direction: "desc",
			}),
		).toBe(
			'WITH user_query AS (\nSELECT * FROM users\n)\nSELECT * FROM user_query WHERE active = true ORDER BY "created_at" DESC;',
		);
	});

	test("builds stable composite primary-key row identities", () => {
		const columns = [
			{ name: "tenant_id", primary_key: true },
			{ name: "record_id", primary_key: true },
			{ name: "title", primary_key: false },
		] as TableColumn[];
		expect(
			getPrimaryKeyRowKey(
				{ tenant_id: 4, record_id: "abc", title: "Example" },
				columns,
			),
		).toBe('[["tenant_id",4],["record_id","abc"]]');
		expect(getPrimaryKeyRowKey({ id: 1 }, [])).toBeNull();
	});

	test("compares structured cell values by serialized value", () => {
		expect(areCellValuesEqual({ enabled: true }, { enabled: true })).toBe(true);
		expect(areCellValuesEqual([1, 2], [2, 1])).toBe(false);
	});
});

describe("CSV serialization", () => {
	test("serializes one header order and escapes CSV-sensitive values", () => {
		expect(
			serializeRowsToCsv([
				{ id: 1, label: "alpha,beta", note: 'said "hello"', metadata: null },
				{ id: 2, label: "line\nbreak", note: { active: true }, metadata: undefined },
			]),
		).toBe(
			'id,label,note,metadata\n1,"alpha,beta","said ""hello""",\n2,"line\nbreak","{""active"":true}",',
		);
	});

	test("returns an empty string for no rows", () => {
		expect(serializeRowsToCsv([])).toBe("");
	});
});
