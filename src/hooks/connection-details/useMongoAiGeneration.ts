import { useReducer } from "react";
import { toast } from "sonner";
import { useAIGeneration } from "../useAIGeneration";
import {
	createQueryAiState,
	queryAiStateReducer,
} from "../../lib/aiDraftState";
import { isAiGenerationCancellation } from "../../lib/aiGenerationSession";
import {
	buildMongoQuerySpec,
	parseMongoQuerySpec,
	serializeMongoQuerySpec,
} from "../../lib/mongo/querySpec";
import type { MongoWorkbenchController } from "./useMongoWorkbench";

export function useMongoAiGeneration(
	connectionUuid: string,
	workbench: MongoWorkbenchController,
) {
	const [state, dispatch] = useReducer(
		queryAiStateReducer,
		undefined,
		createQueryAiState,
	);
	const generation = useAIGeneration();
	const requestKey = `mongodb:${connectionUuid}`;

	const generate = async () => {
		const requestId = crypto.randomUUID();
		dispatch({ type: "update-draft", action: { type: "start", requestId } });
		try {
			const existingQuery = serializeMongoQuerySpec(
				buildMongoQuerySpec(workbench.editor, workbench.namespace),
			);
			let accumulated = "";
			let completed = "";
			await generation.generateSQL(
				requestKey,
				"mongodb",
				state.instruction,
				existingQuery,
				workbench.catalog.flatMap((database) =>
					database.collections.map((collection) => ({
						schema: database.name,
						name: collection.name,
					})),
				),
				(chunk) => {
					accumulated += chunk;
					dispatch({
						type: "update-draft",
						action: { type: "preview", requestId, sql: accumulated },
					});
				},
				(query) => {
					completed = query;
				},
			);
			dispatch({
				type: "update-draft",
				action: { type: "complete", requestId, sql: completed || accumulated },
			});
		} catch (error) {
			if (isAiGenerationCancellation(error)) return;
			dispatch({
				type: "update-draft",
				action: {
					type: "fail",
					requestId,
					message: error instanceof Error ? error.message : String(error),
				},
			});
		}
	};

	const useDraft = () => {
		if (state.draft.status !== "ready") return;
		try {
			parseMongoQuerySpec(state.draft.sql);
			workbench.actions.loadQuery(state.draft.sql);
			dispatch({ type: "update-draft", action: { type: "discard" } });
			toast.success("AI query loaded", {
				description: "Review the draft, then run it when you’re ready.",
			});
		} catch (error) {
			toast.error("AI returned an invalid MongoDB query", {
				description: error instanceof Error ? error.message : String(error),
			});
		}
	};

	const discard = () => {
		generation.cancelGeneration(requestKey);
		dispatch({ type: "update-draft", action: { type: "discard" } });
	};

	return {
		state,
		configured: generation.isConfigured,
		setInstruction: (instruction: string) =>
			dispatch({ type: "set-instruction", instruction }),
		generate,
		useDraft,
		discard,
	};
}
