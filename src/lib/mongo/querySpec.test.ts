import { describe, expect, test } from "bun:test";
import {
	buildMongoQuerySpec,
	mongoQueryKind,
	parseMongoQuerySpec,
	queryEditorFromSpec,
	serializeMongoQuerySpec,
} from "./querySpec";

describe("MongoDB query specifications", () => {
	test("round-trips a versioned find query", () => {
		const spec = {
			version: 1 as const,
			type: "find" as const,
			database: "app",
			collection: "users",
			filter: { active: true },
			projection: { name: 1 },
			sort: { created_at: -1 },
			limit: 100,
		};

		expect(parseMongoQuerySpec(serializeMongoQuerySpec(spec))).toEqual(spec);
	});

	test("rejects malformed persisted query shapes", () => {
		expect(() =>
			parseMongoQuerySpec(
				JSON.stringify({
					version: 1,
					type: "find",
					database: "app",
					collection: "users",
					filter: [],
				}),
			),
		).toThrow("filter must be a JSON object");
	});

	test("rejects find queries that omit the filter instead of loading an empty one", () => {
		expect(() =>
			parseMongoQuerySpec(
				JSON.stringify({
					version: 1,
					type: "find",
					database: "app",
					collection: "users",
					projection: {},
					sort: {},
				}),
			),
		).toThrow("filter must be a JSON object");
	});

	test("rejects unsupported query versions", () => {
		expect(() =>
			parseMongoQuerySpec(
				JSON.stringify({
					version: 2,
					type: "aggregate",
					database: "app",
					collection: "events",
					pipeline: [],
				}),
			),
		).toThrow("Unsupported MongoDB query format");
	});

	test("builds one typed find specification from editor state", () => {
		const spec = buildMongoQuerySpec(
			{ type: "find", filter: "{\"active\":true}", projection: "{}", sort: "{}" },
			{ database: "app", collection: "users" },
		);

		expect(spec).toEqual({
			version: 1,
			type: "find",
			database: "app",
			collection: "users",
			filter: { active: true },
			projection: {},
			sort: {},
			limit: 100,
		});
		expect(mongoQueryKind(spec)).toBe("mongo_find");
		expect(queryEditorFromSpec(spec)).toEqual({
			type: "find",
			filter: '{\n  "active": true\n}',
			projection: "{}",
			sort: "{}",
		});
	});

	test("accepts common Mongo shell object syntax in find editors", () => {
		const spec = buildMongoQuerySpec(
			{
				type: "find",
				filter: `{ name: 'Amal', score: { $gt: 5, }, }`,
				projection: "{ name: 1 }",
				sort: "{ name: 1 }",
			},
			{ database: "app", collection: "users" },
		);

		expect(spec).toMatchObject({
			type: "find",
			filter: { name: "Amal", score: { $gt: 5 } },
			projection: { name: 1 },
			sort: { name: 1 },
		});
	});

	test("accepts common Mongo shell object syntax in aggregation stages", () => {
		const spec = buildMongoQuerySpec(
			{
				type: "aggregate",
				pipeline: `[{ $match: { name: 'Amal' } }]`,
			},
			{ database: "app", collection: "users" },
		);

		expect(spec).toMatchObject({
			type: "aggregate",
			pipeline: [{ $match: { name: "Amal" } }],
		});
	});

	test("rejects JSON5 numeric values that cannot cross the Tauri boundary", () => {
		expect(() =>
			buildMongoQuerySpec(
				{
					type: "find",
					filter: "{ score: Infinity }",
					projection: "{}",
					sort: "{}",
				},
				{ database: "app", collection: "users" },
			),
		).toThrow("filter must contain only finite JSON numbers");
	});
});
