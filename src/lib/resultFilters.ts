export interface IntegerFilterValue {
	kind: "integer";
	value: string;
}

export type FilterScalar =
	| string
	| number
	| boolean
	| null
	| IntegerFilterValue;

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

export type FilterColumnKind =
	| "text"
	| "integer"
	| "decimal"
	| "boolean"
	| "temporal"
	| "uuid"
	| "other";

export interface FilterCondition {
	column: string;
	operator: FilterOperator;
	value?: FilterScalar | FilterScalar[];
}

export interface FilterExpression {
	conjunction: "and" | "or";
	conditions: FilterCondition[];
}

export type TableFilter =
	| { kind: "advanced"; value: string }
	| { kind: "structured"; value: FilterExpression };

export interface TableFilterState {
	draft: TableFilter;
	applied: TableFilter | null;
}

export function createTableFilterState(): TableFilterState {
	return {
		draft: {
			kind: "structured",
			value: { conjunction: "and", conditions: [] },
		},
		applied: null,
	};
}

export function shouldShowFilterEditor(
	showInput: boolean,
	state: TableFilterState,
): boolean {
	return showInput || state.applied !== null;
}

export function getFilterRequest(filter: TableFilter | null): {
	filter?: string;
	structuredFilter?: FilterExpression;
} {
	if (!filter) return {};
	return filter.kind === "advanced"
		? { filter: filter.value }
		: { structuredFilter: filter.value };
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

const TEXT_FILTER_OPERATORS: FilterOperator[] = [
	"equals",
	"not_equals",
	"contains",
	"starts_with",
	"ends_with",
	"in",
	"is_null",
	"is_not_null",
];

const ORDERED_FILTER_OPERATORS: FilterOperator[] = [
	"equals",
	"not_equals",
	"greater_than",
	"greater_than_or_equal",
	"less_than",
	"less_than_or_equal",
	"in",
	"is_null",
	"is_not_null",
];

const BOOLEAN_FILTER_OPERATORS: FilterOperator[] = [
	"equals",
	"not_equals",
	"is_null",
	"is_not_null",
];

const CONSERVATIVE_FILTER_OPERATORS: FilterOperator[] = [
	"equals",
	"not_equals",
	"in",
	"is_null",
	"is_not_null",
];

function normalizeColumnType(dataType: string): string {
	let normalizedType = dataType.trim().toLowerCase().replace(/\s+/g, " ");
	let wrappedType = normalizedType.match(
		/^(?:nullable|lowcardinality)\((.*)\)$/,
	);

	while (wrappedType) {
		normalizedType = wrappedType[1].trim();
		wrappedType = normalizedType.match(/^(?:nullable|lowcardinality)\((.*)\)$/);
	}

	return normalizedType;
}

export function getFilterColumnKind(dataType: string): FilterColumnKind {
	const normalizedType = normalizeColumnType(dataType);

	if (
		/^(?:array|map|tuple|nested|object)\s*\(/.test(normalizedType) ||
		/(^|\W)(?:jsonb?|blob|bytea|binary|varbinary)(\W|$)/.test(normalizedType)
	) {
		return "other";
	}

	if (/(^|\W)uuid(\W|$)/.test(normalizedType)) return "uuid";
	if (/^(?:bool|boolean)$/.test(normalizedType)) return "boolean";
	if (
		/(^|\W)(?:date32|datetime64|datetime|date|timestamptz|timestamp|timetz|time|interval)(\W|$)/.test(
			normalizedType,
		)
	) {
		return "temporal";
	}
	if (
		/(^|\W)(?:tinyint|smallint|mediumint|bigint|integer|int2|int4|int8|smallserial|bigserial|serial|u?int(?:8|16|32|64|128|256)?)(\W|$)/.test(
			normalizedType,
		)
	) {
		return "integer";
	}
	if (
		/(^|\W)(?:decimal|numeric|number|real|float|double|money)(\W|$)/.test(
			normalizedType,
		)
	) {
		return "decimal";
	}
	if (
		/(^|\W)(?:character varying|character|nvarchar|varchar|citext|text|clob|fixedstring|string)(\W|$)/.test(
			normalizedType,
		)
	) {
		return "text";
	}

	return "other";
}

export function getFilterOperatorsForColumn(
	dataType: string,
): FilterOperator[] {
	switch (getFilterColumnKind(dataType)) {
		case "text":
			return TEXT_FILTER_OPERATORS;
		case "integer":
		case "decimal":
		case "temporal":
			return ORDERED_FILTER_OPERATORS;
		case "boolean":
			return BOOLEAN_FILTER_OPERATORS;
		default:
			return CONSERVATIVE_FILTER_OPERATORS;
	}
}

export function operatorNeedsValue(operator: FilterOperator): boolean {
	return operator !== "is_null" && operator !== "is_not_null";
}

export function changeFilterConditionColumn(
	condition: FilterCondition,
	column: string,
	dataType: string,
): FilterCondition {
	const allowedOperators = getFilterOperatorsForColumn(dataType);

	return {
		column,
		operator: allowedOperators.includes(condition.operator)
			? condition.operator
			: "equals",
		value: undefined,
	};
}

export function changeFilterConditionOperator(
	condition: FilterCondition,
	operator: FilterOperator,
): FilterCondition {
	if (!operatorNeedsValue(operator)) {
		return { ...condition, operator, value: undefined };
	}

	const changesValueShape =
		(condition.operator === "in") !== (operator === "in");

	return {
		...condition,
		operator,
		value: changesValueShape ? "" : (condition.value ?? ""),
	};
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
	const columnKind = getFilterColumnKind(dataType);
	if (columnKind === "boolean") {
		if (value.toLowerCase() === "true") return true;
		if (value.toLowerCase() === "false") return false;
	}
	if (columnKind === "integer") {
		if (/^[+-]?\d+$/.test(value.trim())) {
			return { kind: "integer", value: value.trim() };
		}
	}
	if (columnKind === "decimal") {
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
