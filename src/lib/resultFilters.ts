export interface IntegerFilterValue {
	kind: "integer";
	value: string;
}

export type FilterScalar = string | number | boolean | null | IntegerFilterValue;

export type FilterOperator =
	| "equals"
	| "not_equals"
	| "contains"
	| "starts_with"
	| "ends_with"
	| "greater_than"
	| "greater_than_or_equal"
	| "less_than"
	| "less_than_or_equal"
	| "in"
	| "is_null"
	| "is_not_null";

export interface FilterCondition {
	column: string;
	operator: FilterOperator;
	value?: FilterScalar | FilterScalar[];
}

export interface FilterExpression {
	conjunction: "and" | "or";
	conditions: FilterCondition[];
}

export const FILTER_OPERATOR_LABELS: Record<FilterOperator, string> = {
	equals: "is",
	not_equals: "is not",
	contains: "contains",
	starts_with: "starts with",
	ends_with: "ends with",
	greater_than: "is greater than",
	greater_than_or_equal: "is at least",
	less_than: "is less than",
	less_than_or_equal: "is at most",
	in: "is one of",
	is_null: "is null",
	is_not_null: "is not null",
};

export const FILTER_OPERATORS = Object.keys(
	FILTER_OPERATOR_LABELS,
) as FilterOperator[];

export function operatorNeedsValue(operator: FilterOperator): boolean {
	return operator !== "is_null" && operator !== "is_not_null";
}

export function isConditionComplete(condition: FilterCondition): boolean {
	if (!condition.column.trim()) return false;
	if (!operatorNeedsValue(condition.operator)) return true;
	if (Array.isArray(condition.value)) return condition.value.length > 0;
	return condition.value !== undefined && condition.value !== "";
}

function normalizeCellValue(value: unknown): FilterScalar {
	if (value === null || typeof value === "string") return value;
	if (typeof value === "number" || typeof value === "boolean") return value;
	return JSON.stringify(value);
}

export function createCellFilter(
	column: string,
	value: unknown,
	exclude: boolean,
): FilterCondition {
	if (value === null) {
		return {
			column,
			operator: exclude ? "is_not_null" : "is_null",
		};
	}

	return {
		column,
		operator: exclude ? "not_equals" : "equals",
		value: normalizeCellValue(value),
	};
}

function describeValue(value: FilterCondition["value"]): string {
	if (Array.isArray(value)) return value.map(describeScalar).join(", ");
	if (value === null) return "null";
	return value === undefined ? "" : describeScalar(value);
}

function describeScalar(value: FilterScalar): string {
	return typeof value === "object" && value !== null
		? value.value
		: String(value);
}

export function describeFilterExpression(expression: FilterExpression): string {
	return expression.conditions
		.filter(isConditionComplete)
		.map((condition) => {
			const label = FILTER_OPERATOR_LABELS[condition.operator];
			return operatorNeedsValue(condition.operator)
				? `${condition.column} ${label} ${describeValue(condition.value)}`
				: `${condition.column} ${label}`;
		})
		.join(` ${expression.conjunction} `);
}

function coerceScalar(value: FilterScalar, dataType: string): FilterScalar {
	if (typeof value !== "string") return value;
	const normalizedType = dataType.toLowerCase();
	if (/bool/.test(normalizedType)) {
		if (value.toLowerCase() === "true") return true;
		if (value.toLowerCase() === "false") return false;
	}
	if (
		/(^|\W)(tinyint|smallint|integer|bigint|int|serial)/.test(
			normalizedType,
		)
	) {
		if (/^[+-]?\d+$/.test(value.trim())) {
			return { kind: "integer", value: value.trim() };
		}
	}
	if (/(^|\W)(decimal|numeric|real|float|double)/.test(normalizedType)) {
		const number = Number(value);
		if (Number.isFinite(number)) return number;
	}
	return value;
}

export function coerceFilterExpression(
	expression: FilterExpression,
	columnTypes: Record<string, string>,
): FilterExpression {
	return {
		...expression,
		conditions: expression.conditions.map((condition) => {
			if (!operatorNeedsValue(condition.operator)) {
				return { ...condition, value: undefined };
			}

			const type = columnTypes[condition.column] ?? "text";
			const rawValues =
				condition.operator === "in" && typeof condition.value === "string"
					? condition.value.split(",").map((value) => value.trim())
					: condition.value;
			const value = Array.isArray(rawValues)
				? rawValues.map((item) => coerceScalar(item, type))
				: coerceScalar(rawValues ?? null, type);

			return { ...condition, value };
		}),
	};
}
