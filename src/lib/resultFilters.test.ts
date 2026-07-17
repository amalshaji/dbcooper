import { describe, expect, test } from "bun:test";
import {
	coerceFilterExpression,
	createTableFilterState,
	createCellFilter,
	describeFilterExpression,
	getFilterColumnKind,
	getFilterOperatorsForColumn,
	getFilterRequest,
	isConditionComplete,
	type FilterExpression,
} from "./resultFilters";

describe("result filters", () => {
	test("creates equality and exclusion filters from a cell", () => {
		expect(createCellFilter("status", "active", false)).toEqual({
			column: "status",
			operator: "equals",
			value: "active",
		});
		expect(createCellFilter("status", "active", true)).toEqual({
			column: "status",
			operator: "not_equals",
			value: "active",
		});
	});

	test("uses null-aware operators for null cells", () => {
		expect(createCellFilter("deleted_at", null, false)).toEqual({
			column: "deleted_at",
			operator: "is_null",
		});
		expect(createCellFilter("deleted_at", null, true)).toEqual({
			column: "deleted_at",
			operator: "is_not_null",
		});
	});

	test("requires values only for operators that need them", () => {
		expect(
			isConditionComplete({
				column: "name",
				operator: "contains",
				value: "cooper",
			}),
		).toBe(true);
		expect(isConditionComplete({ column: "name", operator: "contains" })).toBe(
			false,
		);
		expect(
			isConditionComplete({ column: "name", operator: "is_not_null" }),
		).toBe(true);
	});

	test("describes multi-condition filters without exposing SQL", () => {
		const expression: FilterExpression = {
			conjunction: "and",
			conditions: [
				{ column: "status", operator: "equals", value: "active" },
				{ column: "deleted_at", operator: "is_null" },
			],
		};

		expect(describeFilterExpression(expression)).toBe(
			"status is active and deleted_at is null",
		);
	});

	test("coerces numeric, boolean, and list values from the editor", () => {
		const expression = coerceFilterExpression(
			{
				conjunction: "and",
				conditions: [
					{ column: "age", operator: "greater_than", value: "18" },
					{ column: "active", operator: "equals", value: "true" },
					{ column: "role", operator: "in", value: "admin, editor" },
				],
			},
			{ age: "integer", active: "boolean", role: "text" },
		);

		expect(expression.conditions.map((condition) => condition.value)).toEqual([
			{ kind: "integer", value: "18" },
			true,
			["admin", "editor"],
		]);
	});

	test("classifies PostgreSQL, SQLite, and ClickHouse column types", () => {
		expect(getFilterColumnKind("character varying")).toBe("text");
		expect(getFilterColumnKind("VARCHAR(255)")).toBe("text");
		expect(getFilterColumnKind("LowCardinality(String)")).toBe("text");
		expect(getFilterColumnKind("bigint")).toBe("integer");
		expect(getFilterColumnKind("INTEGER")).toBe("integer");
		expect(getFilterColumnKind("Nullable(UInt64)")).toBe("integer");
		expect(getFilterColumnKind("double precision")).toBe("decimal");
		expect(getFilterColumnKind("REAL")).toBe("decimal");
		expect(getFilterColumnKind("Decimal(12, 2)")).toBe("decimal");
		expect(getFilterColumnKind("boolean")).toBe("boolean");
		expect(getFilterColumnKind("Nullable(Bool)")).toBe("boolean");
		expect(getFilterColumnKind("timestamp with time zone")).toBe("temporal");
		expect(getFilterColumnKind("DATETIME")).toBe("temporal");
		expect(getFilterColumnKind("DateTime64(3)")).toBe("temporal");
		expect(getFilterColumnKind("uuid")).toBe("uuid");
		expect(getFilterColumnKind("Array(String)")).toBe("other");
		expect(getFilterColumnKind("BLOB")).toBe("other");
		expect(getFilterColumnKind("USER-DEFINED")).toBe("other");
	});

	test("offers operators compatible with the selected column type", () => {
		expect(getFilterOperatorsForColumn("text")).toEqual([
			"equals",
			"not_equals",
			"contains",
			"starts_with",
			"ends_with",
			"in",
			"is_null",
			"is_not_null",
		]);
		expect(getFilterOperatorsForColumn("Nullable(Int64)")).toEqual([
			"equals",
			"not_equals",
			"greater_than",
			"greater_than_or_equal",
			"less_than",
			"less_than_or_equal",
			"in",
			"is_null",
			"is_not_null",
		]);
		expect(getFilterOperatorsForColumn("timestamp")).toEqual([
			"equals",
			"not_equals",
			"greater_than",
			"greater_than_or_equal",
			"less_than",
			"less_than_or_equal",
			"in",
			"is_null",
			"is_not_null",
		]);
		expect(getFilterOperatorsForColumn("boolean")).toEqual([
			"equals",
			"not_equals",
			"is_null",
			"is_not_null",
		]);
		expect(getFilterOperatorsForColumn("uuid")).toEqual([
			"equals",
			"not_equals",
			"in",
			"is_null",
			"is_not_null",
		]);
		expect(getFilterOperatorsForColumn("jsonb")).toEqual([
			"equals",
			"not_equals",
			"in",
			"is_null",
			"is_not_null",
		]);
	});

	test("coerces wrapped ClickHouse scalar and list values", () => {
		const expression = coerceFilterExpression(
			{
				conjunction: "and",
				conditions: [
					{ column: "visits", operator: "in", value: "1, 2" },
					{ column: "score", operator: "greater_than", value: "1.5" },
					{ column: "enabled", operator: "equals", value: "false" },
				],
			},
			{
				visits: "Nullable(UInt64)",
				score: "Decimal(12, 2)",
				enabled: "Nullable(Bool)",
			},
		);

		expect(expression.conditions.map((condition) => condition.value)).toEqual([
			[
				{ kind: "integer", value: "1" },
				{ kind: "integer", value: "2" },
			],
			1.5,
			false,
		]);
	});

	test("preserves 64-bit integers without JavaScript precision loss", () => {
		const expression: FilterExpression = {
			conjunction: "and",
			conditions: [
				{
					column: "external_id",
					operator: "equals",
					value: "9007199254740993",
				},
			],
		};

		const coerced = coerceFilterExpression(expression, {
			external_id: "bigint",
		});

		expect(coerced.conditions[0]?.value).toEqual({
			kind: "integer",
			value: "9007199254740993",
		});
	});

	test("represents exactly one table filter mode at a time", () => {
		const state = createTableFilterState();
		expect(state).toEqual({
			draft: {
				kind: "structured",
				value: { conjunction: "and", conditions: [] },
			},
			applied: null,
		});
		expect(
			getFilterRequest({ kind: "advanced", value: "status = 'active'" }),
		).toEqual({ filter: "status = 'active'" });
		expect(
			getFilterRequest({
				kind: "structured",
				value: {
					conjunction: "and",
					conditions: [
						{ column: "status", operator: "equals", value: "active" },
					],
				},
			}),
		).toEqual({
			structuredFilter: {
				conjunction: "and",
				conditions: [
					{ column: "status", operator: "equals", value: "active" },
				],
			},
		});
	});
});
