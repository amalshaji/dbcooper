export type AiDraftState =
	| { status: "idle" }
	| { status: "generating"; sql: string }
	| { status: "ready"; sql: string }
	| { status: "error"; message: string };

export type AiDraftAction =
	| { type: "start" }
	| { type: "preview"; sql: string }
	| { type: "complete"; sql: string }
	| { type: "fail"; message: string }
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
			return { status: "generating", sql: "" };
		case "preview":
			return state.status === "generating"
				? { status: "generating", sql: action.sql }
				: state;
		case "complete":
			if (state.status !== "generating") return state;
			return action.sql.trim()
				? { status: "ready", sql: action.sql }
				: {
						status: "error",
						message: "The AI provider returned an empty response",
					};
		case "fail":
			return state.status === "generating"
				? { status: "error", message: action.message }
				: state;
		case "discard":
			return initialAiDraftState;
	}
}
