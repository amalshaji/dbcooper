import {
	type Dispatch,
	type SetStateAction,
	useCallback,
	useEffect,
	useRef,
} from "react";
import { toast } from "sonner";
import {
	queryAiStateReducer,
	type QueryAiStateAction,
	type SqlEditScope,
} from "../lib/aiDraftState";
import { isAiGenerationCancellation } from "../lib/aiGenerationSession";
import {
	applyReadyAiDraft,
	type AiDraftApplyMode,
} from "../lib/sqlAiDraft";
import type { QueryTab, Tab } from "../types/tabTypes";

type GenerateDraft = (
	requestKey: string,
	instruction: string,
	scope: SqlEditScope,
	onPreview: (sql: string) => void,
) => Promise<string>;

function getExistingSqlForAi(query: string): string {
	return query.trim().toUpperCase() === "SELECT * FROM" ? "" : query;
}

interface UseQueryAiGenerationOptions {
	tabs: Tab[];
	activeTabId: string | null;
	setTabs: Dispatch<SetStateAction<Tab[]>>;
	setActiveTabId: Dispatch<SetStateAction<string | null>>;
	generateDraft: GenerateDraft;
	cancelGeneration: (requestKey: string) => void;
	isConfigured: boolean | null;
}

export function useQueryAiGeneration({
	tabs,
	activeTabId,
	setTabs,
	setActiveTabId,
	generateDraft,
	cancelGeneration,
	isConfigured,
}: UseQueryAiGenerationOptions) {
	const tabsRef = useRef(tabs);
	const activeTabIdRef = useRef(activeTabId);
	useEffect(() => {
		tabsRef.current = tabs;
		activeTabIdRef.current = activeTabId;
	}, [activeTabId, tabs]);

	const updateAiState = useCallback(
		(tabId: string, action: QueryAiStateAction) => {
			setTabs((currentTabs) =>
				currentTabs.map((tab) =>
					tab.id === tabId && tab.type === "query"
						? { ...tab, ai: queryAiStateReducer(tab.ai, action) }
						: tab,
				),
			);
		},
		[setTabs],
	);

	const generateForTab = useCallback(
		async (tabId: string, instruction: string, requestedScope: SqlEditScope) => {
			const requestId = crypto.randomUUID();
			const scope: SqlEditScope =
				requestedScope.kind === "query"
					? { kind: "query", sql: getExistingSqlForAi(requestedScope.sql) }
					: requestedScope;
			updateAiState(tabId, {
				type: "update-draft",
				action: { type: "start", requestId, scope },
			});

			const viewQuery = () => {
				if (tabsRef.current.some((tab) => tab.id === tabId)) {
					setActiveTabId(tabId);
				}
			};

			try {
				const sql = await generateDraft(
					tabId,
					instruction,
					scope,
					(previewSql) =>
						updateAiState(tabId, {
							type: "update-draft",
							action: { type: "preview", requestId, sql: previewSql },
						}),
				);
				updateAiState(tabId, {
					type: "update-draft",
					action: { type: "complete", requestId, sql },
				});

				const completedTab = tabsRef.current.find((tab) => tab.id === tabId);
				if (completedTab && activeTabIdRef.current !== tabId) {
					toast.success("AI query ready", {
						description: `Generated SQL is ready in ${completedTab.title}.`,
						action: { label: "View query", onClick: viewQuery },
					});
				}
			} catch (error) {
				updateAiState(tabId, {
					type: "update-draft",
					action: {
						type: "fail",
						requestId,
						message: error instanceof Error ? error.message : String(error),
					},
				});

				const failedTab = tabsRef.current.find((tab) => tab.id === tabId);
				if (
					!isAiGenerationCancellation(error) &&
					failedTab &&
					activeTabIdRef.current !== tabId
				) {
					toast.error("AI query generation failed", {
						description: error instanceof Error ? error.message : String(error),
						action: { label: "View query", onClick: viewQuery },
					});
				}
			}
		},
		[generateDraft, setActiveTabId, updateAiState],
	);

	const applyDraft = useCallback(
		(tabId: string, mode: AiDraftApplyMode) => {
			setTabs((currentTabs) =>
				currentTabs.map((tab) => {
					if (tab.id !== tabId || tab.type !== "query") return tab;
					if (tab.ai.draft.status !== "ready") return tab;

					const applied = applyReadyAiDraft(tab.query, tab.ai.draft, mode);
					if (!applied.ok) return tab;

					return {
						...tab,
						query: applied.sql,
						ai: {
							...tab.ai,
							draft: { status: "idle" },
						},
					};
				}),
			);
		},
		[setTabs],
	);

	const getEditorAiProps = useCallback(
		(tab: QueryTab) => ({
			state: tab.ai,
			configured: isConfigured,
			onInstructionChange: (instruction: string) =>
				updateAiState(tab.id, { type: "set-instruction", instruction }),
			onDraftChange: (sql: string) =>
				updateAiState(tab.id, {
					type: "update-draft",
					action: { type: "edit", sql },
				}),
			onGenerate: (scope: SqlEditScope) =>
				generateForTab(tab.id, tab.ai.instruction, scope),
			onApplyDraft: (mode: AiDraftApplyMode) => applyDraft(tab.id, mode),
			onDiscard: () =>
				updateAiState(tab.id, {
					type: "update-draft",
					action: { type: "discard" },
				}),
		}),
		[applyDraft, generateForTab, isConfigured, updateAiState],
	);

	return {
		getEditorAiProps,
		cancelTabGeneration: cancelGeneration,
	};
}
