import { invoke } from "@tauri-apps/api/core";

export type AiInspectLevel = "none" | "summary" | "rows";

export interface AiChatStep {
	id: number;
	kind: "query" | "describe";
	language: string | null;
	query: string;
	purpose: string | null;
	inspect: AiInspectLevel | null;
	row_count: number | null;
	truncated: boolean;
	duration_ms: number | null;
	error: string | null;
	running: boolean;
}

export interface AiChatResult {
	step: number;
	rows: unknown[];
	truncated: boolean;
}

export type AiChatWriteStatus =
	| "pending"
	| "executing"
	| "executed"
	| "failed"
	| "rejected";

export interface AiChatWrite {
	language: string;
	query: unknown;
	display: string;
	summary: string;
	status: AiChatWriteStatus;
	rows_affected: number | null;
	error: string | null;
}

export interface AiChatMessage {
	id: number;
	conversation_id: number;
	role: "user" | "assistant";
	text: string;
	steps: AiChatStep[];
	result: AiChatResult | null;
	chart: unknown;
	error: string | null;
	write?: AiChatWrite | null;
	created_at: string;
}

export interface AiConversation {
	id: number;
	connection_uuid: string;
	title: string;
	created_at: string;
	updated_at: string;
}

export interface AiChatExchange {
	conversation: AiConversation;
	user_message: AiChatMessage;
	assistant_message: AiChatMessage;
}

export interface AiChatWriteResolution {
	conversation: AiConversation;
	updated_message: AiChatMessage;
	assistant_message: AiChatMessage | null;
}

export interface AiChatStepEvent {
	session_id: string;
	step: AiChatStep;
}

export const AI_CHAT_STEP_EVENT = "ai-chat-step";
/** Emitted once an approved write has finished; until then it can't be stopped. */
export const AI_CHAT_WRITE_FINISHED_EVENT = "ai-chat-write-finished";

export const aiChatApi = {
	send: (args: {
		sessionId: string;
		connectionUuid: string;
		conversationId: number | null;
		message: string;
	}) => invoke<AiChatExchange>("ai_chat_send", args),

	resolveWrite: (args: {
		sessionId: string;
		messageId: number;
		approve: boolean;
	}) => invoke<AiChatWriteResolution>("ai_chat_resolve_write", args),

	cancel: (sessionId: string) =>
		invoke<boolean>("ai_chat_cancel", { sessionId }),

	listConversations: (connectionUuid: string) =>
		invoke<AiConversation[]>("ai_chat_list_conversations", { connectionUuid }),

	getMessages: (conversationId: number) =>
		invoke<AiChatMessage[]>("ai_chat_get_messages", { conversationId }),

	deleteConversation: (conversationId: number) =>
		invoke<void>("ai_chat_delete_conversation", { conversationId }),
};
