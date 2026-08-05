import JSON5 from "json5";

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
export type MongoNamespace = Pick<
	MongoQuerySpecBase,
	"database" | "collection"
>;
export type MongoQueryEditor =
	| {
			type: "find";
			filter: string;
			projection: string;
			sort: string;
			limit: number;
	  }
	| { type: "aggregate"; pipeline: string; limit: number };

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

function parseEditorObject(value: string, label: string): JsonObject {
	return readObject(parseEditorJson(value, label), label);
}

function parseEditorJson(value: string, label: string): unknown {
	let parsed: unknown;
	try {
		parsed = JSON.parse(value);
	} catch {
		parsed = JSON5.parse(value);
	}
	const normalized = JSON.stringify(parsed, (_key, nested) => {
		if (typeof nested === "number" && !Number.isFinite(nested)) {
			throw new Error(`${label} must contain only finite JSON numbers`);
		}
		return nested;
	});
	return normalized === undefined ? undefined : JSON.parse(normalized);
}

function readString(value: unknown, label: string): string {
	if (typeof value !== "string" || !value) {
		throw new Error(`${label} must be a non-empty string`);
	}
	return value;
}

function readLimit(value: unknown): number {
	if (!Number.isInteger(value) || Number(value) < 1 || Number(value) > 1_000) {
		throw new Error("limit must be an integer between 1 and 1000");
	}
	return Number(value);
}

export function parseMongoQuerySpec(value: string): MongoQuerySpec {
	const parsed: unknown = JSON.parse(value);
	if (!isObject(parsed) || parsed.version !== 1) {
		throw new Error("Unsupported MongoDB query format");
	}

	const database = readString(parsed.database, "database");
	const collection = readString(parsed.collection, "collection");
	const limit = readLimit(parsed.limit ?? 100);

	if (parsed.type === "find") {
		return {
			version: 1,
			type: "find",
			database,
			collection,
			filter: readObject(parsed.filter, "filter"),
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

export function buildMongoQuerySpec(
	editor: MongoQueryEditor,
	namespace: MongoNamespace,
): MongoQuerySpec {
	if (editor.type === "find") {
		return {
			version: 1,
			type: "find",
			...namespace,
			filter: parseEditorObject(editor.filter, "filter"),
			projection: parseEditorObject(editor.projection, "projection"),
			sort: parseEditorObject(editor.sort, "sort"),
			limit: readLimit(editor.limit),
		};
	}

	const pipeline = parseEditorJson(editor.pipeline, "pipeline");
	if (!Array.isArray(pipeline) || pipeline.some((stage) => !isObject(stage))) {
		throw new Error("pipeline must be an array of JSON objects");
	}
	return {
		version: 1,
		type: "aggregate",
		...namespace,
		pipeline,
		limit: readLimit(editor.limit),
	};
}

export function queryEditorFromSpec(spec: MongoQuerySpec): MongoQueryEditor {
	if (spec.type === "find") {
		return {
			type: "find",
			filter: JSON.stringify(spec.filter, null, 2),
			projection: JSON.stringify(spec.projection, null, 2),
			sort: JSON.stringify(spec.sort, null, 2),
			limit: spec.limit,
		};
	}
	return {
		type: "aggregate",
		pipeline: JSON.stringify(spec.pipeline, null, 2),
		limit: spec.limit,
	};
}

export function mongoQueryKind(spec: MongoQuerySpec): MongoQueryKind {
	return spec.type === "find" ? "mongo_find" : "mongo_aggregate";
}
