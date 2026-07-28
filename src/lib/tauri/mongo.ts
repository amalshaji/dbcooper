import { invoke } from "@tauri-apps/api/core";
import type { JsonObject } from "@/lib/mongo/querySpec";
import type { TestConnectionResult } from "@/lib/tauri/shared";

export interface MongoCollectionInfo {
	database: string;
	name: string;
}

export interface MongoDatabaseInfo {
	name: string;
	collections: MongoCollectionInfo[];
}

export interface MongoFindRequest {
	database: string;
	collection: string;
	filter: JsonObject;
	projection?: JsonObject;
	sort?: JsonObject;
	skip?: number;
	limit?: number;
}

export interface MongoAggregateRequest {
	database: string;
	collection: string;
	pipeline: JsonObject[];
	limit?: number;
}

export interface MongoDocumentPage {
	documents: JsonObject[];
	returned_count: number;
	has_more: boolean;
	execution_time_ms: number;
	estimated_total: number | null;
}

export interface MongoDocumentMutation {
	database: string;
	collection: string;
	document: JsonObject;
}

export interface MongoReplaceRequest extends MongoDocumentMutation {
	id: unknown;
}

export interface MongoDeleteRequest {
	database: string;
	collection: string;
	id: unknown;
}

export interface MongoMutationResult {
	acknowledged: boolean;
	id: unknown | null;
}

export interface MongoIndexInfo {
	name: string;
	keys: JsonObject;
	unique: boolean;
	sparse: boolean;
	expire_after_seconds: number | null;
}

export interface CreateMongoIndexRequest {
	database: string;
	collection: string;
	keys: Array<{ field: string; direction: 1 | -1 }>;
	name?: string;
	unique: boolean;
	sparse: boolean;
	expire_after_seconds?: number;
}

export interface MongoValidatorSettings {
	validator: JsonObject;
	validation_level: "off" | "strict" | "moderate";
	validation_action: "error" | "warn";
}

export interface SetMongoValidatorRequest {
	database: string;
	collection: string;
	validator: JsonObject;
	validation_level: "off" | "strict" | "moderate";
	validation_action: "error" | "warn";
}

export const mongoApi = {
	testConnection: (connectionUri: string) =>
		invoke<TestConnectionResult>("mongo_test_connection", { connectionUri }),
	listCatalog: (uuid: string) =>
		invoke<MongoDatabaseInfo[]>("mongo_list_catalog", { uuid }),
	find: (uuid: string, request: MongoFindRequest) =>
		invoke<MongoDocumentPage>("mongo_find", { uuid, request }),
	aggregate: (uuid: string, request: MongoAggregateRequest) =>
		invoke<MongoDocumentPage>("mongo_aggregate", { uuid, request }),
	insertOne: (uuid: string, request: MongoDocumentMutation) =>
		invoke<MongoMutationResult>("mongo_insert_one", { uuid, request }),
	replaceOne: (uuid: string, request: MongoReplaceRequest) =>
		invoke<MongoMutationResult>("mongo_replace_one", { uuid, request }),
	deleteOne: (uuid: string, request: MongoDeleteRequest) =>
		invoke<MongoMutationResult>("mongo_delete_one", { uuid, request }),
	createCollection: (uuid: string, database: string, collection: string) =>
		invoke<void>("mongo_create_collection", { uuid, database, collection }),
	dropCollection: (uuid: string, database: string, collection: string) =>
		invoke<void>("mongo_drop_collection", { uuid, database, collection }),
	listIndexes: (uuid: string, database: string, collection: string) =>
		invoke<MongoIndexInfo[]>("mongo_list_indexes", {
			uuid,
			database,
			collection,
		}),
	createIndex: (uuid: string, request: CreateMongoIndexRequest) =>
		invoke<string>("mongo_create_index", { uuid, request }),
	dropIndex: (
		uuid: string,
		database: string,
		collection: string,
		name: string,
	) => invoke<void>("mongo_drop_index", { uuid, database, collection, name }),
	getValidator: (uuid: string, database: string, collection: string) =>
		invoke<MongoValidatorSettings>("mongo_get_validator", {
			uuid,
			database,
			collection,
		}),
	setValidator: (uuid: string, request: SetMongoValidatorRequest) =>
		invoke<void>("mongo_set_validator", { uuid, request }),
};
