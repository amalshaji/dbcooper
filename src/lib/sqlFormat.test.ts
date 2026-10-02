import { expect, test } from "bun:test";
import { beautifySql, formatSql } from "./sqlFormat";

test("beautifies single-line SQL with upper-case keywords", () => {
	expect(
		beautifySql(
			"select category, count(*) as orders from products group by category order by category",
			"postgres",
		),
	).toBe(
		[
			"SELECT",
			"  category,",
			"  count(*) AS orders",
			"FROM",
			"  products",
			"GROUP BY",
			"  category",
			"ORDER BY",
			"  category",
		].join("\n"),
	);
});

test("keeps the original text when it cannot be parsed", () => {
	const broken = "select (( from";
	expect(() => formatSql(broken, "postgres")).toThrow();
	expect(beautifySql(broken, "postgres")).toBe(broken);
});
