import { describe, expect, test } from "bun:test";
import {
	captureSavedViewState,
	createColumnLayout,
	getSavedViewStatus,
	hasUnappliedFilterDraft,
	isSavedViewStateEqual,
	moveColumn,
	reconcileSavedViewState,
	reorderColumn,
} from "./savedViews";
import type { SavedViewStateV1 } from "./tauri";

describe("saved view state", () => {
	test("captures the applied filter, sort, and normalized column layout", () => {
		const state = captureSavedViewState(
			{ kind: "advanced", value: "status = 'open'" },
			{ column: "created_at", direction: "desc" },
			{
				columnOrder: ["created_at", "id"],
				hiddenColumns: ["id"],
				columnWidths: { created_at: 220 },
			},
		);

		expect(state).toEqual({
			version: 1,
			filter: { kind: "advanced", value: "status = 'open'" },
			sort: { column: "created_at", direction: "desc" },
			column_order: ["created_at", "id"],
			hidden_columns: ["id"],
			column_widths: { created_at: 220 },
		});
	});

	test("reconciles layout drift and drops a vanished sort column", () => {
		const saved: SavedViewStateV1 = {
			version: 1,
			filter: null,
			sort: { column: "removed", direction: "asc" },
			column_order: ["removed", "name", "id"],
			hidden_columns: ["removed", "id"],
			column_widths: { removed: 200, name: 900 },
		};

		const result = reconcileSavedViewState(
			{ status: "current", state: saved },
			["id", "name", "created_at"],
		);

		expect(result.error).toBeNull();
		expect(result.warning).toContain("sort column");
		expect(result.state?.sort).toBeNull();
		expect(result.layout).toEqual({
			columnOrder: ["name", "id", "created_at"],
			hiddenColumns: ["id"],
			columnWidths: { name: 300 },
		});
	});

	test("blocks a structured filter that references a vanished column", () => {
		const saved: SavedViewStateV1 = {
			version: 1,
			filter: {
				kind: "structured",
				value: {
					conjunction: "and",
					conditions: [{ column: "removed", operator: "equals", value: "x" }],
				},
			},
			sort: null,
			column_order: [],
			hidden_columns: [],
			column_widths: {},
		};

		const result = reconcileSavedViewState(
			{ status: "current", state: saved },
			["id", "name"],
		);

		expect(result.state).toBeNull();
		expect(result.error).toContain("removed");
	});

	test("compares equivalent state independently of width insertion order", () => {
		const left = captureSavedViewState(null, null, {
			columnOrder: ["id", "name"],
			hiddenColumns: [],
			columnWidths: { id: 120, name: 200 },
		});
		const right = captureSavedViewState(null, null, {
			columnOrder: ["id", "name"],
			hiddenColumns: [],
			columnWidths: { name: 200, id: 120 },
		});

		expect(isSavedViewStateEqual(left, right)).toBe(true);
	});

	test("compares layouts by visible behavior instead of storage order", () => {
		const saved = captureSavedViewState(null, null, {
			columnOrder: ["id", "name", "created_at"],
			hiddenColumns: ["name", "created_at"],
			columnWidths: {},
		});
		const equivalent = captureSavedViewState(null, null, {
			columnOrder: ["id", "name", "created_at"],
			hiddenColumns: ["created_at", "name"],
			columnWidths: { id: 150 },
		});

		expect(isSavedViewStateEqual(saved, equivalent)).toBe(true);
	});

	test("rejects a future state before reading version-specific fields", () => {
		const result = reconcileSavedViewState(
			{ status: "unsupported", version: 2 },
			["id"],
		);

		expect(result.state).toBeNull();
		expect(result.error).toContain("newer version");
	});

	test("moves columns without mutating the source order", () => {
		const order = ["id", "name", "created_at"];
		expect(moveColumn(order, "created_at", -1)).toEqual([
			"id",
			"created_at",
			"name",
		]);
		expect(order).toEqual(["id", "name", "created_at"]);
	});

	test("reorders a dragged column at the hovered position", () => {
		expect(
			reorderColumn(["id", "name", "created_at"], "created_at", "id"),
		).toEqual(["created_at", "id", "name"]);
	});

	test("creates an all-visible layout in schema order", () => {
		expect(createColumnLayout(["id", "name"])).toEqual({
			columnOrder: ["id", "name"],
			hiddenColumns: [],
			columnWidths: {},
		});
	});

	test("marks only changes to the active saved snapshot as edited", () => {
		const state = captureSavedViewState(null, null, createColumnLayout(["id"]));
		const activeView = {
			id: 7,
			state: { status: "current" as const, state },
		};

		expect(getSavedViewStatus(7, [activeView], state)).toEqual({
			activeView,
			isEdited: false,
		});

		const resized = captureSavedViewState(null, null, {
			...createColumnLayout(["id"]),
			columnWidths: { id: 220 },
		});
		expect(getSavedViewStatus(7, [activeView], resized).isEdited).toBe(true);
	});

	test("has no edited state when no saved view is selected", () => {
		const state = captureSavedViewState(null, null, createColumnLayout(["id"]));
		expect(getSavedViewStatus(null, [], state)).toEqual({
			activeView: null,
			isEdited: false,
		});
	});

	test("ignores the empty initial filter draft but detects unapplied edits", () => {
		expect(
			hasUnappliedFilterDraft(
				{ kind: "structured", value: { conjunction: "and", conditions: [] } },
				null,
			),
		).toBe(false);
		expect(
			hasUnappliedFilterDraft(
				{ kind: "advanced", value: "status = 'new'" },
				null,
			),
		).toBe(true);
		expect(
			hasUnappliedFilterDraft(
				{ kind: "advanced", value: "status = 'new'" },
				{ kind: "advanced", value: "status = 'new'" },
			),
		).toBe(false);
	});
});
