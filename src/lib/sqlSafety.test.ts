import { describe, expect, test } from "bun:test";
import { classifySqlIntent } from "./sqlSafety";

describe("classifySqlIntent", () => {
	test("recognizes read-only SQL after comments", () => {
		expect(classifySqlIntent("-- generated\nSELECT * FROM users")).toBe("read");
	});

	test("flags data and schema mutations", () => {
		expect(classifySqlIntent("UPDATE users SET active = false")).toBe("write");
		expect(classifySqlIntent("DROP TABLE users")).toBe("write");
	});

	test("keeps incomplete streamed SQL unknown", () => {
		expect(classifySqlIntent("SEL")).toBe("unknown");
	});

	test("checks every statement instead of trusting the first one", () => {
		expect(classifySqlIntent("SELECT 1; DELETE FROM users")).toBe("write");
	});

	test("treats mutating explain analyze statements as writes", () => {
		expect(classifySqlIntent("EXPLAIN ANALYZE DELETE FROM users")).toBe(
			"write",
		);
		expect(classifySqlIntent("EXPLAIN SELECT * FROM users")).toBe("read");
	});

	test("does not mistake mutation words in CTE values or comments for writes", () => {
		expect(
			classifySqlIntent(
				"WITH notes AS (SELECT 'delete from users' AS message) SELECT * FROM notes",
			),
		).toBe("read");
		expect(
			classifySqlIntent(
				"WITH users AS (SELECT 1) /* DELETE FROM users */ SELECT * FROM users",
			),
		).toBe("read");
	});

	test("recognizes data-modifying CTEs", () => {
		expect(
			classifySqlIntent(
				"WITH changed AS (UPDATE users SET active = true RETURNING *) SELECT * FROM changed",
			),
		).toBe("write");
	});
});
