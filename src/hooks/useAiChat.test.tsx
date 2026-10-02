import { afterEach, expect, mock, test } from "bun:test";
import { GlobalRegistrator } from "@happy-dom/global-registrator";
import type {
	AiChatExchange,
	AiChatStep,
	AiChatStepEvent,
} from "@/lib/tauri/aiChat";
import { DOCKER_DATABASE_ENGINES } from "../types/docker";

if (!globalThis.document) GlobalRegistrator.register();

type StepHandler = (event: { payload: AiChatStepEvent }) => void;
const handlers = new Set<StepHandler>();
const sendCalls: Array<{ sessionId: string; conversationId: number | null }> =
	[];
const cancelCalls: string[] = [];
const resolveCalls: Array<{ messageId: number; approve: boolean }> = [];
const toastErrors: string[] = [];
let sendImpl: (args: {
	sessionId: string;
	conversationId: number | null;
	message: string;
}) => Promise<AiChatExchange>;

mock.module("@tauri-apps/api/event", () => ({
	listen: async (_event: string, handler: StepHandler) => {
		handlers.add(handler);
		return () => handlers.delete(handler);
	},
}));
mock.module("sonner", () => ({
	toast: { error: (message: string) => toastErrors.push(message) },
}));
mock.module("@/lib/tauri/aiChat", () => ({
	AI_CHAT_STEP_EVENT: "ai-chat-step",
}));
mock.module("@/lib/tauri", () => ({
	DOCKER_DATABASE_ENGINES,
	api: {
		ai: { getStatus: async () => ({ configured: true }) },
		aiChat: {
			listConversations: async () => [
				{
					id: 1,
					connection_uuid: "c1",
					title: "Older",
					created_at: "",
					updated_at: "",
				},
			],
			getMessages: async () => [],
			deleteConversation: async () => undefined,
			resolveWrite: async (args: { messageId: number; approve: boolean }) => {
				resolveCalls.push(args);
				return {
					conversation: {
						id: 2,
						connection_uuid: "c1",
						title: "Notes",
						created_at: "",
						updated_at: "",
					},
					updated_message: {
						...exchange("x").assistant_message,
						write: { ...pendingWrite, status: "executed", rows_affected: 0 },
					},
					assistant_message: {
						...exchange("x").assistant_message,
						id: 12,
						text: "Created.",
					},
				};
			},
			cancel: async (sessionId: string) => {
				cancelCalls.push(sessionId);
				return true;
			},
			send: (args: {
				sessionId: string;
				conversationId: number | null;
				message: string;
			}) => {
				sendCalls.push(args);
				return sendImpl(args);
			},
		},
	},
}));

const { act, cleanup, renderHook, waitFor } = await import(
	"@testing-library/react"
);
const { upsertStep, useAiChat } = await import("./useAiChat");

function step(id: number, running: boolean): AiChatStep {
	return {
		id,
		kind: "query",
		language: "sql",
		query: "SELECT 1",
		purpose: null,
		inspect: "none",
		row_count: running ? null : 1,
		truncated: false,
		duration_ms: running ? null : 3,
		error: null,
		running,
	};
}

function emit(payload: AiChatStepEvent) {
	for (const handler of handlers) handler({ payload });
}

const pendingWrite = {
	language: "sql",
	query: "CREATE TABLE notes (id INTEGER)",
	display: "CREATE TABLE notes (id INTEGER)",
	summary: "Create notes",
	status: "pending" as const,
	rows_affected: null,
	error: null,
};

function exchange(message: string): AiChatExchange {
	const base = { conversation_id: 2, steps: [], result: null, chart: null, error: null, created_at: "" };
	return {
		conversation: {
			id: 2,
			connection_uuid: "c1",
			title: message,
			created_at: "",
			updated_at: "",
		},
		user_message: { ...base, id: 10, role: "user", text: message },
		assistant_message: { ...base, id: 11, role: "assistant", text: "Two." },
	};
}

afterEach(() => {
	cleanup();
	handlers.clear();
	sendCalls.length = 0;
	cancelCalls.length = 0;
	resolveCalls.length = 0;
	toastErrors.length = 0;
});

test("upserts steps by id", () => {
	const running = step(1, true);
	const done = step(1, false);
	expect(upsertStep([running], done)).toEqual([done]);
	expect(upsertStep([done], step(2, true))).toHaveLength(2);
});

test("streams steps for its own session and stores the exchange", async () => {
	let release: () => void = () => undefined;
	sendImpl = (args) =>
		new Promise((resolve) => {
			release = () => resolve(exchange(args.message));
		});
	const { result } = renderHook(() => useAiChat("c1"));
	await waitFor(() => expect(result.current.conversations).toHaveLength(1));

	let sent: Promise<boolean> = Promise.resolve(false);
	act(() => {
		sent = result.current.send("  How many users?  ");
	});
	await waitFor(() => expect(sendCalls).toHaveLength(1));
	const sessionId = sendCalls[0].sessionId;
	expect(sendCalls[0].conversationId).toBeNull();

	act(() => {
		emit({ session_id: sessionId, step: step(1, true) });
		emit({ session_id: "other-session", step: step(9, true) });
		emit({ session_id: sessionId, step: step(1, false) });
	});
	expect(result.current.pending?.text).toBe("How many users?");
	expect(result.current.pending?.steps).toEqual([step(1, false)]);

	await act(async () => {
		release();
		expect(await sent).toBe(true);
	});
	expect(result.current.pending).toBeNull();
	expect(result.current.activeConversationId).toBe(2);
	expect(result.current.messages.map((message) => message.id)).toEqual([10, 11]);
	expect(result.current.conversations.map((item) => item.id)).toEqual([2, 1]);
	expect(handlers.size).toBe(0);
});

test("reports failures and cancels the running session", async () => {
	let fail: (error: Error) => void = () => undefined;
	sendImpl = () =>
		new Promise((_, reject) => {
			fail = reject;
		});
	const { result } = renderHook(() => useAiChat("c1"));

	let sent: Promise<boolean> = Promise.resolve(true);
	act(() => {
		sent = result.current.send("Revenue?");
	});
	await waitFor(() => expect(sendCalls).toHaveLength(1));

	act(() => result.current.cancel());
	expect(cancelCalls).toEqual([sendCalls[0].sessionId]);

	await act(async () => {
		fail(new Error("Connection not found"));
		expect(await sent).toBe(false);
	});
	expect(toastErrors).toEqual(["Ask AI failed"]);
	expect(result.current.pending).toBeNull();
	expect(result.current.messages).toEqual([]);
});

test("approves a proposed write and appends the continuation", async () => {
	sendImpl = async (args) => {
		const result = exchange(args.message);
		return {
			...result,
			assistant_message: { ...result.assistant_message, write: pendingWrite },
		};
	};
	const { result } = renderHook(() => useAiChat("c1"));
	await act(async () => {
		await result.current.send("create a notes table");
	});
	expect(result.current.messages[1].write?.status).toBe("pending");

	await act(async () => {
		await result.current.resolveWrite(11, true);
	});
	expect(resolveCalls).toEqual([
		expect.objectContaining({ messageId: 11, approve: true }),
	]);
	expect(result.current.messages.map((message) => message.id)).toEqual([
		10, 11, 12,
	]);
	expect(result.current.messages[1].write?.status).toBe("executed");
	expect(result.current.pending).toBeNull();
});

test("a new question supersedes a pending write", async () => {
	sendImpl = async (args) => {
		const result = exchange(args.message);
		return args.message === "first"
			? {
					...result,
					assistant_message: { ...result.assistant_message, write: pendingWrite },
				}
			: {
					...result,
					user_message: { ...result.user_message, id: 20 },
					assistant_message: { ...result.assistant_message, id: 21 },
				};
	};
	const { result } = renderHook(() => useAiChat("c1"));
	await act(async () => {
		await result.current.send("first");
	});
	await act(async () => {
		await result.current.send("never mind");
	});
	expect(result.current.messages[1].write?.status).toBe("rejected");
	expect(result.current.messages).toHaveLength(4);
});
