import { describe, expect, test } from "bun:test";
import {
	getSqlFormatterLanguage,
	isFileDatabase,
	supportsStructuredRowMutations,
} from "./databaseCapabilities";

describe("database capabilities", () => {
	test("treats DuckDB as a local analytics database", () => {
		expect(isFileDatabase("duckdb")).toBe(true);
		expect(supportsStructuredRowMutations("duckdb")).toBe(false);
		expect(getSqlFormatterLanguage("duckdb")).toBe("duckdb");
	});

	test("preserves existing engine capabilities", () => {
		expect(isFileDatabase("sqlite")).toBe(true);
		expect(isFileDatabase("postgres")).toBe(false);
		expect(supportsStructuredRowMutations("postgres")).toBe(true);
		expect(supportsStructuredRowMutations("clickhouse")).toBe(false);
		expect(supportsStructuredRowMutations("redis")).toBe(false);
		expect(getSqlFormatterLanguage("redis")).toBe("sql");
	});
});
