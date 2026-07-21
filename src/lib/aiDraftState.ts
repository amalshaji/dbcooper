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

export const initialAiDraftState: AiDraftState = { status: "idle" };

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
