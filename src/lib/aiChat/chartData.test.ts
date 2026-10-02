import { describe, expect, test } from "bun:test";
import {
	buildChartData,
	formatLabel,
	inferChartSpec,
	MAX_SERIES,
	metricValue,
	parseTimestamp,
	resolveChartSpec,
	timeAxisFormat,
	toDataset,
	toNumber,
} from "./chartData";

const monthly = toDataset([
	{ month: "2026-01", revenue: "120.50", orders: 3 },
	{ month: "2026-02", revenue: 80, orders: 2 },
]);

describe("toDataset", () => {
	test("unions object keys in order and wraps scalar rows", () => {
		expect(toDataset([{ a: 1 }, { b: 2, a: 3 }]).columns).toEqual(["a", "b"]);
		expect(toDataset(["x"]).rows).toEqual([{ value: "x" }]);
	});
});

describe("toNumber and formatLabel", () => {
	test("coerce driver string numbers and MongoDB extended JSON", () => {
		expect(toNumber("12.5")).toBe(12.5);
		expect(toNumber({ $numberDecimal: "3.2" })).toBe(3.2);
		expect(toNumber("")).toBeNull();
		expect(toNumber("abc")).toBeNull();
		expect(toNumber(true)).toBeNull();
	});

	test("labels ids, dates, and nulls readably", () => {
		expect(formatLabel({ $oid: "abc" })).toBe("abc");
		expect(formatLabel({ $date: { $numberLong: "0" } })).toBe(
			"1970-01-01T00:00:00.000Z",
		);
		expect(formatLabel(null)).toBe("(null)");
	});
});

describe("inferChartSpec", () => {
	test("uses a line for temporal x and a metric for one number", () => {
		expect(inferChartSpec(monthly)).toMatchObject({
			type: "line",
			x: "month",
			y: ["revenue"],
		});
		expect(inferChartSpec(toDataset([{ total: 42 }]))).toMatchObject({
			type: "metric",
			y: ["total"],
		});
	});

	test("uses bars for categories and nothing for text-only results", () => {
		expect(
			inferChartSpec(toDataset([{ status: "paid", count: 3 }, { status: "due", count: 1 }]))
				?.type,
		).toBe("bar");
		expect(inferChartSpec(toDataset([{ name: "Ada" }]))).toBeNull();
	});
});

describe("resolveChartSpec", () => {
	test("accepts valid specs and normalises a string y", () => {
		const resolution = resolveChartSpec(
			{ type: "bar", x: "month", y: "orders", title: "Orders" },
			monthly,
		);
		expect(resolution).toEqual({
			ok: true,
			spec: {
				type: "bar",
				x: "month",
				y: ["orders"],
				series: null,
				title: "Orders",
			},
		});
	});

	test("rejects unknown types and non-numeric or missing value columns", () => {
		expect(resolveChartSpec({ type: "radar", y: ["orders"] }, monthly).ok).toBe(
			false,
		);
		expect(resolveChartSpec({ type: "bar", x: "month", y: ["month"] }, monthly).ok).toBe(
			false,
		);
		expect(resolveChartSpec({ type: "bar", y: ["missing"] }, monthly).ok).toBe(
			false,
		);
	});

	test("falls back to the first other column when x is invalid", () => {
		const resolution = resolveChartSpec(
			{ type: "line", x: "nope", y: ["revenue"] },
			monthly,
		);
		expect(resolution.ok && resolution.spec.x).toBe("month");
	});

	test("requires a numeric x for scatter plots", () => {
		expect(
			resolveChartSpec({ type: "scatter", x: "month", y: ["orders"] }, monthly)
				.ok,
		).toBe(false);
		expect(
			resolveChartSpec({ type: "scatter", x: "orders", y: ["revenue"] }, monthly)
				.ok,
		).toBe(true);
	});

	test("infers when the model sent no chart and reports empty results", () => {
		expect(resolveChartSpec(null, monthly).ok).toBe(true);
		expect(resolveChartSpec(null, toDataset([])).ok).toBe(false);
	});
});

describe("buildChartData", () => {
	test("maps y columns to stable series keys", () => {
		const data = buildChartData(
			{ type: "bar", x: "month", y: ["revenue", "orders"], series: null, title: null },
			monthly,
		);
		expect(data.series).toEqual([
			{ key: "s0", label: "revenue" },
			{ key: "s1", label: "orders" },
		]);
		expect(data.points[0]).toEqual({ x: "2026-01", s0: 120.5, s1: 3 });
	});

	test("pivots a series column and folds extras into Other", () => {
		const rows = Array.from({ length: MAX_SERIES + 2 }, (_, index) => ({
			day: "d1",
			country: `c${index}`,
			visits: index + 1,
		}));
		const data = buildChartData(
			{ type: "line", x: "day", y: ["visits"], series: "country", title: null },
			toDataset(rows),
		);
		expect(data.series).toHaveLength(MAX_SERIES);
		expect(data.series[data.series.length - 1].label).toBe("Other");
		expect(data.folded).toBe(3);
		expect(data.points).toHaveLength(1);
		expect(data.points[0][`s${MAX_SERIES - 1}`]).toBe(1 + 2 + 3);
	});

	test("orders pivoted time series by x, not by series", () => {
		const rows = [
			{ region: "A", month: "2026-02-01", sales: 1 },
			{ region: "A", month: "2026-03-01", sales: 2 },
			{ region: "B", month: "2026-01-01", sales: 3 },
			{ region: "B", month: "2026-02-01", sales: 4 },
		];
		const data = buildChartData(
			{ type: "line", x: "month", y: ["sales"], series: "region", title: null },
			toDataset(rows),
		);
		expect(data.points.map((point) => point.x)).toEqual([
			"2026-01-01",
			"2026-02-01",
			"2026-03-01",
		]);
	});

	test("caps scatter series without inventing an Other group", () => {
		const rows = ["a", "b", "c", "d"].map((group, index) => ({
			x: index,
			y: index * 2,
			group,
		}));
		const data = buildChartData(
			{ type: "scatter", x: "x", y: ["y"], series: "group", title: null },
			toDataset(rows),
		);
		expect(data.series).toHaveLength(3);
		expect(data.folded).toBe(1);
		expect(data.points).toHaveLength(3);
	});

	test("sorts pie slices and folds the tail", () => {
		const rows = Array.from({ length: 10 }, (_, index) => ({
			status: `s${index}`,
			count: index + 1,
		}));
		const data = buildChartData(
			{ type: "pie", x: "status", y: ["count"], series: null, title: null },
			toDataset(rows),
		);
		expect(data.points[0]).toMatchObject({ label: "s9", value: 10 });
		expect(data.points[data.points.length - 1]).toMatchObject({ label: "Other", value: 1 + 2 + 3 });
	});

	test("reads a metric value", () => {
		const dataset = toDataset([{ total: "42" }]);
		expect(
			metricValue(
				{ type: "metric", x: null, y: ["total"], series: null, title: null },
				dataset,
			),
		).toBe(42);
	});
});

describe("time axis", () => {
	test("parses database timestamps as UTC wall-clock time", () => {
		expect(parseTimestamp("2026-09-27 00:00:00 UTC")?.toISOString()).toBe(
			"2026-09-27T00:00:00.000Z",
		);
		expect(parseTimestamp("2026-09-27T14:30:00Z")?.toISOString()).toBe(
			"2026-09-27T14:30:00.000Z",
		);
		expect(parseTimestamp("2026-09-27 08:00:00+05:30")?.getUTCHours()).toBe(8);
		expect(parseTimestamp("2026-09")?.toISOString()).toBe(
			"2026-09-01T00:00:00.000Z",
		);
		expect(parseTimestamp("Desks")).toBeNull();
		expect(parseTimestamp(42)).toBeNull();
	});

	test("shows days without the midnight time", () => {
		const format = timeAxisFormat([
			"2026-09-27 00:00:00 UTC",
			"2026-09-28 00:00:00 UTC",
		]);
		const tick = format?.tick("2026-09-27 00:00:00 UTC") ?? "";
		expect(tick).toContain("27");
		expect(tick).toMatch(/Sep/);
		expect(tick).not.toMatch(/00:00|UTC|2026/);
		expect(format?.tooltip("2026-09-27 00:00:00 UTC")).toMatch(/2026/);
	});

	test("shows months, adding the year only when it varies", () => {
		const sameYear = timeAxisFormat(["2026-01-01", "2026-02-01"]);
		expect(sameYear?.tick("2026-02-01")).not.toMatch(/2026/);
		const acrossYears = timeAxisFormat(["2025-12-01", "2026-01-01"]);
		expect(acrossYears?.tick("2025-12-01")).toMatch(/2025/);
	});

	test("shows times for intraday data and ignores non-temporal axes", () => {
		const hourly = timeAxisFormat([
			"2026-09-27 13:00:00 UTC",
			"2026-09-27 14:00:00 UTC",
		]);
		expect(hourly?.tick("2026-09-27 14:00:00 UTC")).toMatch(/14|2/);
		expect(hourly?.tick("2026-09-27 14:00:00 UTC")).not.toMatch(/Sep/);
		expect(timeAxisFormat(["Desks", "Chairs"])).toBeNull();
		expect(timeAxisFormat(["2026-09-27", "Desks"])).toBeNull();
	});
});
