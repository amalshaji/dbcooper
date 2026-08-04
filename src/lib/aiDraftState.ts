export interface SqlSelection {
	from: number;
	to: number;
	text: string;
}

export type SqlEditScope =
	| { kind: "query"; sql: string }
	| { kind: "selection"; sql: string; selection: SqlSelection };

export interface GeneratingAiDraft {
	status: "generating";
	requestId: string;
	scope: SqlEditScope;
	sql: string;
}

export interface ReadyAiDraft {
	status: "ready";
	scope: SqlEditScope;
	sql: string;
}

export type AiDraftState =
	| { status: "idle" }
	| GeneratingAiDraft
	| ReadyAiDraft
	| { status: "error"; message: string };

export type AiDraftAction =
	| {
			type: "start";
			requestId: string;
			scope: SqlEditScope;
	  }
	| { type: "preview"; requestId: string; sql: string }
	| { type: "complete"; requestId: string; sql: string }
	| { type: "edit"; sql: string }
	| { type: "fail"; requestId: string; message: string }
	| { type: "discard" };

export interface QueryAiState {
	instruction: string;
	draft: AiDraftState;
}

export type QueryAiStateAction =
	| { type: "set-instruction"; instruction: string }
	| { type: "update-draft"; action: AiDraftAction };

export const initialAiDraftState: AiDraftState = { status: "idle" };

export function createQueryAiState(): QueryAiState {
	return { instruction: "", draft: initialAiDraftState };
}

export function queryAiStateReducer(
	state: QueryAiState,
	action: QueryAiStateAction,
): QueryAiState {
	if (action.type === "set-instruction") {
		return { ...state, instruction: action.instruction };
	}

	return { ...state, draft: aiDraftReducer(state.draft, action.action) };
}

export function aiDraftReducer(
	state: AiDraftState,
	action: AiDraftAction,
): AiDraftState {
	switch (action.type) {
		case "start":
			return {
				status: "generating",
				requestId: action.requestId,
				scope: action.scope,
				sql: "",
			};
		case "preview":
			return state.status === "generating" &&
				state.requestId === action.requestId
				? { ...state, sql: action.sql }
				: state;
		case "complete":
			if (state.status !== "generating" || state.requestId !== action.requestId)
				return state;
			return action.sql.trim()
				? {
						status: "ready",
						scope: state.scope,
						sql: action.sql,
					}
				: {
						status: "error",
						message: "The AI provider returned an empty response",
					};
		case "edit":
			return state.status === "ready" ? { ...state, sql: action.sql } : state;
		case "fail":
			return state.status === "generating" &&
				state.requestId === action.requestId
				? { status: "error", message: action.message }
				: state;
		case "discard":
			return initialAiDraftState;
	}
}
