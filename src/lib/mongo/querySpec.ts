export type MongoQueryKind = "mongo_find" | "mongo_aggregate";
export type QueryKind = "sql" | MongoQueryKind;
export type JsonObject = Record<string, unknown>;

interface MongoQuerySpecBase {
	version: 1;
	database: string;
	collection: string;
	limit: number;
}

export interface MongoFindSpec extends MongoQuerySpecBase {
	type: "find";
	filter: JsonObject;
	projection: JsonObject;
	sort: JsonObject;
}

export interface MongoAggregateSpec extends MongoQuerySpecBase {
	type: "aggregate";
	pipeline: JsonObject[];
}

export type MongoQuerySpec = MongoFindSpec | MongoAggregateSpec;

function isObject(value: unknown): value is JsonObject {
	return value !== null && typeof value === "object" && !Array.isArray(value);
}

function readObject(
	value: unknown,
	label: string,
	fallback?: JsonObject,
): JsonObject {
	if (value === undefined && fallback) return fallback;
	if (!isObject(value)) throw new Error(`${label} must be a JSON object`);
	return value;
}

function readString(value: unknown, label: string): string {
	if (typeof value !== "string" || !value) {
		throw new Error(`${label} must be a non-empty string`);
	}
	return value;
}

export function parseMongoQuerySpec(value: string): MongoQuerySpec {
	const parsed: unknown = JSON.parse(value);
	if (!isObject(parsed) || parsed.version !== 1) {
		throw new Error("Unsupported MongoDB query format");
	}

	const database = readString(parsed.database, "database");
	const collection = readString(parsed.collection, "collection");
	const limit = typeof parsed.limit === "number" ? parsed.limit : 100;

	if (parsed.type === "find") {
		return {
			version: 1,
			type: "find",
			database,
			collection,
			filter: readObject(parsed.filter, "filter", {}),
			projection: readObject(parsed.projection, "projection", {}),
			sort: readObject(parsed.sort, "sort", {}),
			limit,
		};
	}

	if (parsed.type === "aggregate") {
		if (
			!Array.isArray(parsed.pipeline) ||
			parsed.pipeline.some((stage) => !isObject(stage))
		) {
			throw new Error("pipeline must be an array of JSON objects");
		}
		return {
			version: 1,
			type: "aggregate",
			database,
			collection,
			pipeline: parsed.pipeline,
			limit,
		};
	}

	throw new Error("Unsupported MongoDB query format");
}

export function serializeMongoQuerySpec(spec: MongoQuerySpec): string {
	return JSON.stringify(spec);
}
