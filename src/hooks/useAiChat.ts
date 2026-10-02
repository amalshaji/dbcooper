import { listen } from "@tauri-apps/api/event";
import { useCallback, useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { api } from "@/lib/tauri";
import {
	AI_CHAT_STEP_EVENT,
	AI_CHAT_WRITE_FINISHED_EVENT,
	type AiChatMessage,
	type AiChatStep,
	type AiChatStepEvent,
	type AiConversation,
} from "@/lib/tauri/aiChat";

export interface PendingAiChat {
	sessionId: string;
	text: string | null;
	steps: AiChatStep[];
	/** False while an approved write runs: it cannot be interrupted. */
	cancellable: boolean;
}

export function upsertStep(steps: AiChatStep[], step: AiChatStep) {
	const index = steps.findIndex((existing) => existing.id === step.id);
	if (index === -1) return [...steps, step];
	return steps.map((existing, current) => (current === index ? step : existing));
}

/** A new question supersedes changes still waiting for approval. */
function supersedePendingWrites(messages: AiChatMessage[]) {
	return messages.map((message) =>
		message.write?.status === "pending"
			? { ...message, write: { ...message.write, status: "rejected" as const } }
			: message,
	);
}

export function useAiChat(connectionUuid: string) {
	const [configured, setConfigured] = useState<boolean | null>(null);
	const [conversations, setConversations] = useState<AiConversation[]>([]);
	const [activeConversationId, setActiveConversationId] = useState<
		number | null
	>(null);
	const [messages, setMessages] = useState<AiChatMessage[]>([]);
	const [loadingMessages, setLoadingMessages] = useState(false);
	const [pending, setPending] = useState<PendingAiChat | null>(null);
	const pendingSessionRef = useRef<string | null>(null);
	const selectionRef = useRef(0);

	useEffect(() => {
		const checkConfig = async () => {
			try {
				const status = await api.ai.getStatus();
				setConfigured(status.configured);
			} catch {
				setConfigured(false);
			}
		};

		void checkConfig();
		window.addEventListener("ai-settings-changed", checkConfig);
		return () => window.removeEventListener("ai-settings-changed", checkConfig);
	}, []);

	useEffect(() => {
		let cancelled = false;
		setConversations([]);
		setActiveConversationId(null);
		setMessages([]);
		api.aiChat
			.listConversations(connectionUuid)
			.then((items) => {
				if (!cancelled) setConversations(items);
			})
			.catch((error) => console.error("Failed to load conversations:", error));
		return () => {
			cancelled = true;
		};
	}, [connectionUuid]);

	useEffect(
		() => () => {
			if (pendingSessionRef.current) {
				void api.aiChat.cancel(pendingSessionRef.current);
			}
		},
		[],
	);

	const selectConversation = useCallback(async (conversationId: number) => {
		if (pendingSessionRef.current) return;
		const selection = ++selectionRef.current;
		setActiveConversationId(conversationId);
		setMessages([]);
		setLoadingMessages(true);
		try {
			const items = await api.aiChat.getMessages(conversationId);
			if (selection === selectionRef.current) setMessages(items);
		} catch (error) {
			toast.error("Failed to load conversation", {
				description: error instanceof Error ? error.message : String(error),
			});
		} finally {
			if (selection === selectionRef.current) setLoadingMessages(false);
		}
	}, []);

	const startNewConversation = useCallback(() => {
		if (pendingSessionRef.current) return;
		selectionRef.current++;
		setActiveConversationId(null);
		setMessages([]);
		setLoadingMessages(false);
	}, []);

	const deleteConversation = useCallback(
		async (conversationId: number) => {
			try {
				await api.aiChat.deleteConversation(conversationId);
				setConversations((items) =>
					items.filter((item) => item.id !== conversationId),
				);
				if (conversationId === activeConversationId) startNewConversation();
			} catch (error) {
				toast.error("Failed to delete conversation", {
					description: error instanceof Error ? error.message : String(error),
				});
			}
		},
		[activeConversationId, startNewConversation],
	);

	const runSession = useCallback(
		async <T,>(
			text: string | null,
			call: (sessionId: string) => Promise<T>,
			cancellable = true,
		): Promise<T | null> => {
			if (pendingSessionRef.current) return null;
			const sessionId = crypto.randomUUID();
			pendingSessionRef.current = sessionId;
			setPending({ sessionId, text, steps: [], cancellable });

			const unlisteners: Array<() => void> = [];
			try {
				unlisteners.push(
					await listen<AiChatStepEvent>(AI_CHAT_STEP_EVENT, (event) => {
						if (event.payload.session_id !== sessionId) return;
						setPending((current) =>
							current?.sessionId === sessionId
								? {
										...current,
										steps: upsertStep(current.steps, event.payload.step),
									}
								: current,
						);
					}),
					await listen<{ session_id: string }>(
						AI_CHAT_WRITE_FINISHED_EVENT,
						(event) => {
							if (event.payload.session_id !== sessionId) return;
							setPending((current) =>
								current?.sessionId === sessionId
									? { ...current, cancellable: true }
									: current,
							);
						},
					),
				);
				return await call(sessionId);
			} catch (error) {
				toast.error("Ask AI failed", {
					description: error instanceof Error ? error.message : String(error),
				});
				return null;
			} finally {
				for (const unlisten of unlisteners) unlisten();
				pendingSessionRef.current = null;
				setPending(null);
			}
		},
		[],
	);

	const promoteConversation = useCallback((conversation: AiConversation) => {
		setActiveConversationId(conversation.id);
		setConversations((items) => [
			conversation,
			...items.filter((item) => item.id !== conversation.id),
		]);
	}, []);

	const send = useCallback(
		async (text: string): Promise<boolean> => {
			const message = text.trim();
			if (!message) return false;
			const exchange = await runSession(message, (sessionId) =>
				api.aiChat.send({
					sessionId,
					connectionUuid,
					conversationId: activeConversationId,
					message,
				}),
			);
			if (!exchange) return false;
			setMessages((items) => [
				...supersedePendingWrites(items),
				exchange.user_message,
				exchange.assistant_message,
			]);
			promoteConversation(exchange.conversation);
			return true;
		},
		[activeConversationId, connectionUuid, promoteConversation, runSession],
	);

	const resolveWrite = useCallback(
		async (messageId: number, approve: boolean) => {
			const resolution = await runSession(
				null,
				(sessionId) => api.aiChat.resolveWrite({ sessionId, messageId, approve }),
				false,
			);
			if (!resolution) return;
			setMessages((items) => {
				const updated = items.map((item) =>
					item.id === resolution.updated_message.id
						? resolution.updated_message
						: item,
				);
				return resolution.assistant_message
					? [...updated, resolution.assistant_message]
					: updated;
			});
			promoteConversation(resolution.conversation);
		},
		[promoteConversation, runSession],
	);

	const cancel = useCallback(() => {
		if (pendingSessionRef.current) {
			void api.aiChat.cancel(pendingSessionRef.current);
		}
	}, []);

	return {
		configured,
		conversations,
		activeConversationId,
		messages,
		loadingMessages,
		pending,
		selectConversation,
		startNewConversation,
		deleteConversation,
		send,
		resolveWrite,
		cancel,
	};
}

export type AiChatController = ReturnType<typeof useAiChat>;
