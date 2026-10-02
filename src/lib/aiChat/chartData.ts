export const CHART_TYPES = [
	"bar",
	"line",
	"area",
	"pie",
	"scatter",
	"metric",
] as const;
export type ChartType = (typeof CHART_TYPES)[number];

export interface ChartSpec {
	type: ChartType;
	x: string | null;
	y: string[];
	series: string | null;
	title: string | null;
}

export type Row = Record<string, unknown>;

export interface Dataset {
	columns: string[];
	rows: Row[];
}

export interface ChartSeries {
	key: string;
	label: string;
}

export interface ChartData {
	points: Array<Record<string, string | number | null>>;
	series: ChartSeries[];
	folded: number;
}

export type ChartResolution =
	| { ok: true; spec: ChartSpec }
	| { ok: false; reason: string };

/** Fixed categorical slots; a ninth series folds into "Other". */
export const MAX_SERIES = 8;
/** Scatter marks overlap, so only the first three slots stay distinguishable. */
export const MAX_SCATTER_SERIES = 3;
const MAX_CATEGORY_POINTS = 200;
const OTHER_LABEL = "Other";
const SCALAR_COLUMN = "value";
const TEMPORAL_NAME = /(date|time|day|week|month|quarter|year|period|_at)$/i;
const TEMPORAL_VALUE = /^\d{4}-\d{2}(-\d{2})?([ T]\d{2}:\d{2})?/;
const EXTENDED_NUMBER_KEYS = [
	"$numberDecimal",
	"$numberLong",
	"$numberInt",
	"$numberDouble",
];

function isPlainObject(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function toDataset(rows: unknown[]): Dataset {
	const columns: string[] = [];
	const seen = new Set<string>();
	const normalized = rows.map((row) => {
		const object = isPlainObject(row) ? row : { [SCALAR_COLUMN]: row };
		for (const key of Object.keys(object)) {
			if (!seen.has(key)) {
				seen.add(key);
				columns.push(key);
			}
		}
		return object;
	});
	return { columns, rows: normalized };
}

export function toNumber(value: unknown): number | null {
	if (typeof value === "number") return Number.isFinite(value) ? value : null;
	if (typeof value === "string") {
		const trimmed = value.trim();
		if (!trimmed) return null;
		const parsed = Number(trimmed);
		return Number.isFinite(parsed) ? parsed : null;
	}
	if (isPlainObject(value)) {
		const key = EXTENDED_NUMBER_KEYS.find((candidate) => candidate in value);
		return key ? toNumber(value[key]) : null;
	}
	return null;
}

export function formatLabel(value: unknown): string {
	if (value === null || value === undefined) return "(null)";
	if (typeof value === "string") return value;
	if (typeof value === "number" || typeof value === "boolean")
		return String(value);
	if (isPlainObject(value)) {
		if (typeof value.$oid === "string") return value.$oid;
		if ("$date" in value) {
			const date = value.$date;
			if (typeof date === "string") return date;
			const millis = toNumber(date);
			if (millis !== null) return new Date(millis).toISOString();
		}
	}
	return JSON.stringify(value);
}

function isNumericColumn(dataset: Dataset, column: string): boolean {
	let any = false;
	for (const row of dataset.rows) {
		const value = row[column];
		if (value === null || value === undefined) continue;
		if (toNumber(value) === null) return false;
		any = true;
	}
	return any;
}

function isTemporalColumn(dataset: Dataset, column: string): boolean {
	if (TEMPORAL_NAME.test(column)) return true;
	const sample = dataset.rows
		.map((row) => row[column])
		.find((value) => value !== null && value !== undefined);
	return typeof sample === "string" && TEMPORAL_VALUE.test(sample);
}

export function inferChartSpec(dataset: Dataset): ChartSpec | null {
	if (dataset.rows.length === 0) return null;
	const numeric = dataset.columns.filter((column) =>
		isNumericColumn(dataset, column),
	);
	const other = dataset.columns.filter((column) => !numeric.includes(column));

	if (dataset.rows.length === 1 && numeric.length === 1) {
		return { type: "metric", x: null, y: numeric, series: null, title: null };
	}
	if (other.length === 0 || numeric.length === 0) return null;
	if (dataset.rows.length > MAX_CATEGORY_POINTS) return null;

	const x = other[0];
	return {
		type: isTemporalColumn(dataset, x) ? "line" : "bar",
		x,
		y: [numeric[0]],
		series: null,
		title: null,
	};
}

/** Validate a model-proposed spec against the actual result; never trust it. */
export function resolveChartSpec(
	raw: unknown,
	dataset: Dataset,
): ChartResolution {
	if (dataset.rows.length === 0) {
		return { ok: false, reason: "The result has no rows to chart." };
	}
	if (raw === null || raw === undefined) {
		const inferred = inferChartSpec(dataset);
		return inferred
			? { ok: true, spec: inferred }
			: { ok: false, reason: "This result is best read as a table." };
	}
	if (!isPlainObject(raw)) {
		return { ok: false, reason: "The chart definition was not valid." };
	}

	const type = CHART_TYPES.find((candidate) => candidate === raw.type);
	if (!type) {
		return {
			ok: false,
			reason: `Unsupported chart type "${String(raw.type)}".`,
		};
	}

	const requestedY = Array.isArray(raw.y)
		? raw.y
		: typeof raw.y === "string"
			? [raw.y]
			: [];
	const y = requestedY.filter(
		(column): column is string =>
			typeof column === "string" &&
			dataset.columns.includes(column) &&
			isNumericColumn(dataset, column),
	);
	if (y.length === 0) {
		return {
			ok: false,
			reason: "The chart's value column is missing or not numeric.",
		};
	}

	const title = typeof raw.title === "string" && raw.title ? raw.title : null;
	if (type === "metric") {
		return { ok: true, spec: { type, x: null, y: [y[0]], series: null, title } };
	}

	const requestedX =
		typeof raw.x === "string" && dataset.columns.includes(raw.x)
			? raw.x
			: null;
	const x =
		requestedX ?? dataset.columns.find((column) => !y.includes(column)) ?? null;
	if (!x) {
		return { ok: false, reason: "The chart needs a column for the x axis." };
	}
	if (type === "scatter" && !isNumericColumn(dataset, x)) {
		return { ok: false, reason: "A scatter plot needs a numeric x column." };
	}

	const series =
		typeof raw.series === "string" &&
		raw.series !== x &&
		dataset.columns.includes(raw.series) &&
		type !== "pie"
			? raw.series
			: null;

	return {
		ok: true,
		spec: {
			type,
			x,
			y: series ? [y[0]] : y.slice(0, MAX_SERIES),
			series,
			title,
		},
	};
}

export function metricValue(spec: ChartSpec, dataset: Dataset): number | null {
	return toNumber(dataset.rows[0]?.[spec.y[0]]);
}

function xValue(spec: ChartSpec, row: Row): string | number | null {
	const value = spec.x ? row[spec.x] : null;
	return spec.type === "scatter" ? toNumber(value) : formatLabel(value);
}

function buildPieData(spec: ChartSpec, dataset: Dataset): ChartData {
	const totals = new Map<string, number>();
	for (const row of dataset.rows) {
		const label = formatLabel(spec.x ? row[spec.x] : null);
		const value = toNumber(row[spec.y[0]]);
		if (value === null || value <= 0) continue;
		totals.set(label, (totals.get(label) ?? 0) + value);
	}
	const slices = [...totals.entries()].sort((a, b) => b[1] - a[1]);
	const kept =
		slices.length > MAX_SERIES ? slices.slice(0, MAX_SERIES - 1) : slices;
	const rest = slices.slice(kept.length);
	if (rest.length > 0) {
		kept.push([OTHER_LABEL, rest.reduce((sum, [, value]) => sum + value, 0)]);
	}
	return {
		points: kept.map(([label, value], index) => ({
			key: `s${index}`,
			label,
			value,
		})),
		series: kept.map(([label], index) => ({ key: `s${index}`, label })),
		folded: rest.length,
	};
}

function buildSeriesData(spec: ChartSpec, dataset: Dataset): ChartData {
	const seriesColumn = spec.series as string;
	const valueColumn = spec.y[0];
	const limit = spec.type === "scatter" ? MAX_SCATTER_SERIES : MAX_SERIES;

	const totals = new Map<string, number>();
	for (const row of dataset.rows) {
		const name = formatLabel(row[seriesColumn]);
		const value = toNumber(row[valueColumn]) ?? 0;
		totals.set(name, (totals.get(name) ?? 0) + Math.abs(value));
	}
	const names = [...totals.keys()];
	let kept = names;
	let foldIntoOther = false;
	if (names.length > limit) {
		const ranked = [...names].sort(
			(a, b) => (totals.get(b) ?? 0) - (totals.get(a) ?? 0),
		);
		foldIntoOther = spec.type !== "scatter";
		const keepCount = foldIntoOther ? limit - 1 : limit;
		const top = new Set(ranked.slice(0, keepCount));
		kept = names.filter((name) => top.has(name));
	}

	const keys = new Map(kept.map((name, index) => [name, `s${index}`]));
	const otherKey = `s${kept.length}`;
	const series: ChartSeries[] = kept.map((name, index) => ({
		key: `s${index}`,
		label: name,
	}));
	if (foldIntoOther) series.push({ key: otherKey, label: OTHER_LABEL });

	const points: ChartData["points"] = [];
	const byX = new Map<string, Record<string, string | number | null>>();
	for (const row of dataset.rows) {
		const name = formatLabel(row[seriesColumn]);
		const key = keys.get(name) ?? (foldIntoOther ? otherKey : null);
		const value = toNumber(row[valueColumn]);
		if (!key || value === null) continue;
		const x = xValue(spec, row);
		if (spec.type === "scatter") {
			points.push({ x, [key]: value });
			continue;
		}
		const pointKey = String(x);
		let point = byX.get(pointKey);
		if (!point) {
			point = { x };
			byX.set(pointKey, point);
			points.push(point);
		}
		const previous = point[key];
		point[key] = (typeof previous === "number" ? previous : 0) + value;
	}

	return {
		points: spec.type === "scatter" ? points : sortByX(points),
		series,
		folded: names.length - kept.length,
	};
}

/** Pivoting groups rows by series first, so restore x order for time or numbers. */
function sortByX(points: ChartData["points"]): ChartData["points"] {
	const keys = points.map((point) => {
		const time = parseTimestamp(point.x);
		return time ? time.getTime() : toNumber(point.x);
	});
	if (keys.some((key) => key === null)) return points;
	return points
		.map((point, index) => ({ point, key: keys[index] as number }))
		.sort((a, b) => a.key - b.key)
		.map(({ point }) => point);
}

export function buildChartData(spec: ChartSpec, dataset: Dataset): ChartData {
	if (spec.type === "pie") return buildPieData(spec, dataset);
	if (spec.series) return buildSeriesData(spec, dataset);

	const series = spec.y.map((label, index) => ({ key: `s${index}`, label }));
	const points = dataset.rows.map((row) => {
		const point: Record<string, string | number | null> = {
			x: xValue(spec, row),
		};
		spec.y.forEach((column, index) => {
			point[`s${index}`] = toNumber(row[column]);
		});
		return point;
	});
	return { points, series, folded: 0 };
}

const TIMESTAMP =
	/^(\d{4})-(\d{2})(?:-(\d{2}))?(?:[ T](\d{2}):(\d{2})(?::(\d{2})(?:\.\d+)?)?)?\s*(?:UTC|Z|([+-])(\d{2}):?(\d{2})?)?$/i;

/**
 * Parse database date/time text ("2026-09-27", "2026-09-27 00:00:00 UTC",
 * ISO strings) as UTC wall-clock time, so a stored midnight never shifts to
 * the previous day in the viewer's time zone.
 */
export function parseTimestamp(value: unknown): Date | null {
	if (typeof value !== "string") return null;
	const match = TIMESTAMP.exec(value.trim());
	if (!match) return null;
	const [, year, month, day = "1", hour = "0", minute = "0", second = "0"] =
		match;
	const millis = Date.UTC(
		Number(year),
		Number(month) - 1,
		Number(day),
		Number(hour),
		Number(minute),
		Number(second),
	);
	return Number.isNaN(millis) ? null : new Date(millis);
}

export interface TimeAxisFormat {
	tick: (value: unknown) => string;
	tooltip: (value: unknown) => string;
}

function formatter(options: Intl.DateTimeFormatOptions) {
	const format = new Intl.DateTimeFormat(undefined, {
		...options,
		timeZone: "UTC",
	});
	return (value: unknown) => {
		const date = parseTimestamp(value);
		return date ? format.format(date) : formatLabel(value);
	};
}

/** Pick tick and tooltip formats from the granularity the data actually has. */
export function timeAxisFormat(values: unknown[]): TimeAxisFormat | null {
	const dates = values.map(parseTimestamp);
	if (dates.length === 0 || dates.some((date) => date === null)) return null;
	const valid = dates as Date[];

	const atMidnight = valid.every(
		(date) =>
			date.getUTCHours() === 0 &&
			date.getUTCMinutes() === 0 &&
			date.getUTCSeconds() === 0,
	);
	const firstOfMonth = atMidnight && valid.every((date) => date.getUTCDate() === 1);
	const years = new Set(valid.map((date) => date.getUTCFullYear()));
	const days = new Set(valid.map((date) => date.toISOString().slice(0, 10)));
	const year = years.size > 1 ? ({ year: "numeric" } as const) : {};

	if (firstOfMonth) {
		return {
			tick: formatter({ month: "short", ...year }),
			tooltip: formatter({ month: "long", year: "numeric" }),
		};
	}
	if (atMidnight) {
		return {
			tick: formatter({ month: "short", day: "numeric", ...year }),
			tooltip: formatter({
				weekday: "short",
				month: "short",
				day: "numeric",
				year: "numeric",
			}),
		};
	}
	return {
		tick:
			days.size === 1
				? formatter({ hour: "2-digit", minute: "2-digit" })
				: formatter({ month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" }),
		tooltip: formatter({
			month: "short",
			day: "numeric",
			year: "numeric",
			hour: "2-digit",
			minute: "2-digit",
		}),
	};
}

export function formatNumber(value: number): string {
	return new Intl.NumberFormat(undefined, {
		notation: Math.abs(value) >= 10_000 ? "compact" : "standard",
		maximumFractionDigits: 2,
	}).format(value);
}
