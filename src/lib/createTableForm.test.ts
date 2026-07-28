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
		const mysqlDraft = createInitialTableDraft("mysql", "app");
		const sqliteDraft = createInitialTableDraft("sqlite");
		const d1Draft = createInitialTableDraft("d1", "database-uuid");

		expect(postgresDraft.schema).toBe("analytics");
		expect(postgresDraft.columns).toHaveLength(1);
		expect(postgresDraft.columns[0].dataType).toBe("TEXT");
		expect(postgresDraft.columns[0].mysqlModifiers).toBeNull();
		expect(mysqlDraft.columns[0].mysqlModifiers).not.toBeNull();
		expect(sqliteDraft.schema).toBe("main");
		expect(d1Draft.schema).toBe("main");
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
				mysqlModifiers: null,
			},
			{
				id: "attempts",
				name: "attempts",
				dataType: "INTEGER",
				nullable: false,
				primaryKey: false,
				unique: false,
				default: { kind: "literal", value: "0" },
				mysqlModifiers: null,
			},
			{
				id: "created",
				name: "created_at",
				dataType: "TIMESTAMPTZ",
				nullable: false,
				primaryKey: false,
				unique: false,
				default: { kind: "expression", value: "current_timestamp" },
				mysqlModifiers: null,
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

	test("builds MySQL native length, decimal, unsigned, and auto increment modifiers", () => {
		const draft = createInitialTableDraft("mysql", "app");
		draft.tableName = "orders";
		draft.columns[0] = {
			...draft.columns[0],
			name: "id",
			dataType: "BIGINT",
			primaryKey: true,
			mysqlModifiers: {
				...draft.columns[0].mysqlModifiers!,
				unsigned: true,
				autoIncrement: true,
			},
		};
		draft.columns.push({
			...draft.columns[0],
			id: "amount",
			name: "amount",
			dataType: "DECIMAL",
			primaryKey: false,
			mysqlModifiers: {
				...draft.columns[0].mysqlModifiers!,
				unsigned: false,
				autoIncrement: false,
				precision: "12",
				scale: "2",
			},
		});

		const request = buildCreateTableRequest(draft, "mysql");
		expect(request.columns[0].mysql_modifiers).toMatchObject({
			unsigned: true,
			auto_increment: true,
		});
		expect(request.columns[1].mysql_modifiers).toMatchObject({
			precision: 12,
			scale: 2,
		});
	});
});
