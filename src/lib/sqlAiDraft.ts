import type {
	GeneratingAiDraft,
	ReadyAiDraft,
	SqlSelection,
} from "./aiDraftState";

export type AiDraftApplyMode = "replace" | "append";

export interface AiDraftReview {
	currentSql: string;
	currentVersionLabel: "Current" | "Selection";
	preservationLabel:
		| "Current query is preserved"
		| "Selected SQL is preserved"
		| "Selected SQL changed in the editor";
	replace: { enabled: true } | { enabled: false; reason: string };
}

export type ApplyAiDraftResult =
	| { ok: true; sql: string }
	| { ok: false; reason: string };

const CHANGED_SELECTION_REASON =
	"The selected SQL changed. Append or discard this draft instead.";

function appendSqlStatement(currentSql: string, draftSql: string): string {
	const current = currentSql.trimEnd();
	const draft = draftSql.trim();
	if (!current) return draft;
	if (!draft) return current;
	return `${current}${current.endsWith(";") ? "" : ";"}\n\n${draft}`;
}

function resolveSelectionRange(
	currentSql: string,
	selection: SqlSelection,
): Pick<SqlSelection, "from" | "to"> | null {
	if (currentSql.slice(selection.from, selection.to) === selection.text) {
		return { from: selection.from, to: selection.to };
	}

	const from = currentSql.indexOf(selection.text);
	if (from < 0 || currentSql.indexOf(selection.text, from + 1) >= 0) return null;
	return { from, to: from + selection.text.length };
}

export function createAiDraftReview(
	currentSql: string,
	draft: GeneratingAiDraft | ReadyAiDraft,
): AiDraftReview {
	if (draft.scope.kind === "query") {
		return {
			currentSql,
			currentVersionLabel: "Current",
			preservationLabel: "Current query is preserved",
			replace: { enabled: true },
		};
	}

	const range = resolveSelectionRange(currentSql, draft.scope.selection);
	return {
		currentSql: range
			? currentSql.slice(range.from, range.to)
			: draft.scope.selection.text,
		currentVersionLabel: "Selection",
		preservationLabel: range
			? "Selected SQL is preserved"
			: "Selected SQL changed in the editor",
		replace: range
			? { enabled: true }
			: { enabled: false, reason: CHANGED_SELECTION_REASON },
	};
}

export function applyReadyAiDraft(
	currentSql: string,
	draft: ReadyAiDraft,
	mode: AiDraftApplyMode,
): ApplyAiDraftResult {
	if (mode === "append") {
		return { ok: true, sql: appendSqlStatement(currentSql, draft.sql) };
	}

	if (draft.scope.kind === "query") {
		return { ok: true, sql: draft.sql };
	}

	const range = resolveSelectionRange(currentSql, draft.scope.selection);
	if (!range) return { ok: false, reason: CHANGED_SELECTION_REASON };
	return {
		ok: true,
		sql: `${currentSql.slice(0, range.from)}${draft.sql}${currentSql.slice(range.to)}`,
	};
}
