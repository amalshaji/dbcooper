import { describe, expect, test } from "bun:test";
import type { ReadyAiDraft } from "./aiDraftState";
import { applyReadyAiDraft, createAiDraftReview } from "./sqlAiDraft";

describe("applyReadyAiDraft", () => {
	test("replaces a uniquely relocated selection in the latest query", () => {
		const draft: ReadyAiDraft = {
			status: "ready",
			scope: {
				kind: "selection",
				sql: "SELECT id, name FROM users",
				selection: { from: 7, to: 15, text: "id, name" },
			},
			sql: "id, name, email",
		};

		expect(
			applyReadyAiDraft(
				"-- keep this comment\nSELECT id, name FROM users",
				draft,
				"replace",
			),
		).toEqual({
			ok: true,
			sql: "-- keep this comment\nSELECT id, name, email FROM users",
		});
	});

	test("refuses to replace a selection that changed or became ambiguous", () => {
		const draft: ReadyAiDraft = {
			status: "ready",
			scope: {
				kind: "selection",
				sql: "SELECT id FROM users",
				selection: { from: 7, to: 9, text: "id" },
			},
			sql: "id, email",
		};

		expect(
			applyReadyAiDraft(
				"SELECT email, id FROM users WHERE owner_id = id",
				draft,
				"replace",
			),
		).toEqual({
			ok: false,
			reason: "The selected SQL changed. Append or discard this draft instead.",
		});
	});

	test("appends a complete statement without coupling to the captured query", () => {
		const draft: ReadyAiDraft = {
			status: "ready",
			scope: { kind: "query", sql: "SELECT id FROM users" },
			sql: "SELECT id FROM organizations;",
		};

		expect(
			applyReadyAiDraft("SELECT email FROM users", draft, "append"),
		).toEqual({
			ok: true,
			sql: "SELECT email FROM users;\n\nSELECT id FROM organizations;",
		});
	});
});

describe("createAiDraftReview", () => {
	test("describes query and selection review without optional target fields", () => {
		const queryDraft: ReadyAiDraft = {
			status: "ready",
			scope: { kind: "query", sql: "SELECT id FROM users" },
			sql: "SELECT id, name FROM users",
		};
		const selectionDraft: ReadyAiDraft = {
			status: "ready",
			scope: {
				kind: "selection",
				sql: "SELECT id FROM users",
				selection: { from: 7, to: 9, text: "id" },
			},
			sql: "id, name",
		};

		expect(createAiDraftReview("SELECT id FROM users", queryDraft)).toEqual({
			currentSql: "SELECT id FROM users",
			currentVersionLabel: "Current",
			preservationLabel: "Current query is preserved",
			replace: { enabled: true },
		});
		expect(
			createAiDraftReview("SELECT email FROM users", selectionDraft),
		).toMatchObject({
			currentSql: "id",
			currentVersionLabel: "Selection",
			preservationLabel: "Selected SQL changed in the editor",
			replace: { enabled: false },
		});
	});
});
