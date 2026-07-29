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
	type SqlSelection,
} from "../lib/aiDraftState";
import { isAiGenerationCancellation } from "../lib/aiGenerationSession";
import type { QueryTab, Tab } from "../types/tabTypes";

type GenerateDraft = (
	requestKey: string,
	instruction: string,
	existingSQL: string,
	selectedSQL: string | undefined,
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
		async (
			tabId: string,
			instruction: string,
			existingSQL: string,
			target?: SqlSelection,
		) => {
			const requestId = crypto.randomUUID();
			updateAiState(tabId, {
				type: "update-draft",
				action: { type: "start", requestId, originalSql: existingSQL, target },
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
					existingSQL,
					target?.text,
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
			onGenerate: (target?: SqlSelection) =>
				generateForTab(
					tab.id,
					tab.ai.instruction,
					target ? tab.query : getExistingSqlForAi(tab.query),
					target,
				),
			onDiscard: () =>
				updateAiState(tab.id, {
					type: "update-draft",
					action: { type: "discard" },
				}),
		}),
		[generateForTab, isConfigured, updateAiState],
	);

	return {
		getEditorAiProps,
		cancelTabGeneration: cancelGeneration,
	};
}
