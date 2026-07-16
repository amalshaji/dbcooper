import { describe, expect, test } from "bun:test";
import {
	createCellFilter,
	describeFilterExpression,
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
		expect(
			isConditionComplete({ column: "name", operator: "contains" }),
		).toBe(false);
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
});
