import { describe, expect, test } from "bun:test";
import {
	buildCreateTableRequest,
	createInitialTableDraft,
	getCreateTableValidationError,
	getDefaultExpressions,
} from "./createTableForm";

describe("create table form", () => {
	test("starts with the correct schema and one text column", () => {
		const postgresDraft = createInitialTableDraft("postgres", "analytics");
		const sqliteDraft = createInitialTableDraft("sqlite");

		expect(postgresDraft.schema).toBe("analytics");
		expect(postgresDraft.columns).toHaveLength(1);
		expect(postgresDraft.columns[0].dataType).toBe("TEXT");
		expect(sqliteDraft.schema).toBe("main");
	});

	test("builds a normalized request with typed safe defaults", () => {
		const draft = createInitialTableDraft("postgres", "public");
		draft.tableName = "account_events";
		draft.columns = [
			{
				id: "id",
				name: "id",
				dataType: "BIGSERIAL",
				nullable: true,
				primaryKey: true,
				unique: false,
				default: { kind: "none" },
			},
			{
				id: "attempts",
				name: "attempts",
				dataType: "INTEGER",
				nullable: false,
				primaryKey: false,
				unique: false,
				default: { kind: "literal", value: "0" },
			},
			{
				id: "created",
				name: "created_at",
				dataType: "TIMESTAMPTZ",
				nullable: false,
				primaryKey: false,
				unique: false,
				default: { kind: "expression", value: "current_timestamp" },
			},
		];

		expect(buildCreateTableRequest(draft, "postgres")).toEqual({
			schema: "public",
			name: "account_events",
			columns: [
				{
					name: "id",
					data_type: "BIGSERIAL",
					nullable: false,
					primary_key: true,
					unique: false,
					default: null,
				},
				{
					name: "attempts",
					data_type: "INTEGER",
					nullable: false,
					primary_key: false,
					unique: false,
					default: { kind: "literal", value: 0 },
				},
				{
					name: "created_at",
					data_type: "TIMESTAMPTZ",
					nullable: false,
					primary_key: false,
					unique: false,
					default: {
						kind: "expression",
						value: "current_timestamp",
					},
				},
			],
		});
	});

	test("rejects identifiers and defaults that cannot be submitted safely", () => {
		const draft = createInitialTableDraft("sqlite");
		draft.tableName = "MixedCase";
		draft.columns[0].name = "event_id";

		expect(getCreateTableValidationError(draft, "sqlite")).toBe(
			"Table name must use lowercase letters, numbers, and underscores",
		);

		draft.tableName = "events";
		draft.columns.push({ ...draft.columns[0], id: "duplicate" });
		expect(getCreateTableValidationError(draft, "sqlite")).toBe(
			"Column names must be unique",
		);

		draft.columns = [draft.columns[0]];
		draft.columns[0].dataType = "INTEGER";
		draft.columns[0].default = {
			kind: "literal",
			value: "not-a-number",
		};
		expect(getCreateTableValidationError(draft, "sqlite")).toBe(
			"Default for event_id must be a number",
		);
	});

	test("offers only the backend-supported expressions for each type", () => {
		expect(getDefaultExpressions("postgres", "TIMESTAMPTZ")).toContain(
			"current_timestamp",
		);
		expect(getDefaultExpressions("postgres", "BIGSERIAL")).toEqual([]);
		expect(getDefaultExpressions("sqlite", "DATETIME")).toContain(
			"datetime('now')",
		);
	});
});
