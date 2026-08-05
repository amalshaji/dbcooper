import { useReducer } from "react";
import { toast } from "sonner";
import { useAIGeneration } from "../useAIGeneration";
import {
	createQueryAiState,
	queryAiStateReducer,
} from "../../lib/aiDraftState";
import { isAiGenerationCancellation } from "../../lib/aiGenerationSession";
import { api } from "../../lib/tauri";
import {
	buildMongoQuerySpec,
	parseMongoQuerySpec,
	serializeMongoQuerySpec,
} from "../../lib/mongo/querySpec";
import type { MongoWorkbenchController } from "./useMongoWorkbench";

const MAX_MONGO_FIELD_HINTS = 80;
const MAX_MONGO_DOCUMENT_SAMPLES = 20;

function mongoFieldType(value: unknown): string {
	if (value === null) return "null";
	if (Array.isArray(value)) return "array";
	return typeof value === "object" ? "object" : typeof value;
}

function inferMongoColumns(documents: Array<Record<string, unknown>>) {
	const sample = documents.slice(0, MAX_MONGO_DOCUMENT_SAMPLES);
	const fields = new Map<
		string,
		{ types: Set<string>; presentCount: number; nullable: boolean }
	>();

	for (const document of sample) {
		for (const [name, value] of Object.entries(document)) {
			const field = fields.get(name) ?? {
				types: new Set<string>(),
				presentCount: 0,
				nullable: false,
			};
			field.presentCount += 1;
			field.nullable ||= value === null;
			if (value !== null) field.types.add(mongoFieldType(value));
			fields.set(name, field);
		}
	}

	return [...fields.entries()]
		.slice(0, MAX_MONGO_FIELD_HINTS)
		.map(([name, field]) => ({
			name,
			type:
				field.types.size === 0
					? "unknown"
					: field.types.size === 1
						? [...field.types][0]
						: "mixed",
			nullable: field.nullable || field.presentCount < sample.length,
		}));
}

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
			let existingQuery: string;
			try {
				existingQuery = serializeMongoQuerySpec(
					buildMongoQuerySpec(workbench.editor, workbench.namespace),
				);
			} catch {
				const baselineEditor =
					workbench.editor.type === "find"
						? {
								type: "find" as const,
								filter: "{}",
								projection: "{}",
								sort: "{}",
								limit: 100,
							}
						: { type: "aggregate" as const, pipeline: "[]", limit: 100 };
				existingQuery = serializeMongoQuerySpec(
					buildMongoQuerySpec(baselineEditor, workbench.namespace),
				);
			}
			let accumulated = "";
			let completed = "";
			const resultMatchesNamespace =
				workbench.resultNamespace?.database === workbench.namespace.database &&
				workbench.resultNamespace?.collection ===
					workbench.namespace.collection;
			let sampleDocuments = resultMatchesNamespace
				? (workbench.result?.documents ?? [])
				: [];
			if (
				sampleDocuments.length === 0 &&
				workbench.namespace.database &&
				workbench.namespace.collection
			) {
				try {
					const sample = await api.mongo.find(connectionUuid, {
						...workbench.namespace,
						filter: {},
						projection: {},
						sort: {},
						limit: MAX_MONGO_DOCUMENT_SAMPLES,
					});
					sampleDocuments = sample.documents;
				} catch {
					sampleDocuments = [];
				}
			}
			const observedColumns = inferMongoColumns(sampleDocuments);
			await generation.generateQuery(
				requestKey,
				state.instruction,
				{
					kind: "mongo",
					existingQuery,
					collections: workbench.catalog.flatMap((database) =>
						database.collections.flatMap((collection) => {
							const selected =
								database.name === workbench.namespace.database &&
								collection.name === workbench.namespace.collection;
							if (collection.is_system && !selected) return [];
							return [
								{
									database: database.name,
									name: collection.name,
									...(selected && observedColumns.length > 0
										? { fields: observedColumns }
										: {}),
								},
							];
						}),
					),
				},
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
