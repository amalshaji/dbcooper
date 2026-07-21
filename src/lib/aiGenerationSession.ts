export interface AiGenerationEvent<T> {
	payload: T;
}

export type AiGenerationListener<T> = (event: AiGenerationEvent<T>) => void;

type Unlisten = () => void;
type Listen = <T>(
	eventName: string,
	handler: AiGenerationListener<T>,
) => Promise<Unlisten>;
type Invoke = (
	command: string,
	args: Record<string, unknown>,
) => Promise<unknown>;

interface AiChunkPayload {
	chunk: string;
	session_id: string;
}

interface AiDonePayload {
	session_id: string;
	full_response: string;
}

interface AiErrorPayload {
	session_id: string;
	error: string;
}

interface StartAiGenerationSessionOptions {
	sessionId: string;
	listen: Listen;
	invoke: Invoke;
	invokeArgs: Record<string, unknown>;
	onChunk: (chunk: string) => void;
	onComplete: (sql: string) => void;
}

interface AiGenerationSession {
	promise: Promise<void>;
	cancel: (error: Error) => void;
}

export function startAiGenerationSession({
	sessionId,
	listen,
	invoke,
	invokeArgs,
	onChunk,
	onComplete,
}: StartAiGenerationSessionOptions): AiGenerationSession {
	const unlisteners = new Set<Unlisten>();
	let settled = false;
	let resolveRequest: () => void = () => undefined;
	let rejectRequest: (error: Error) => void = () => undefined;

	const promise = new Promise<void>((resolve, reject) => {
		resolveRequest = resolve;
		rejectRequest = reject;
	});

	const cleanup = () => {
		for (const unlisten of unlisteners) unlisten();
		unlisteners.clear();
	};

	const finish = (error?: Error) => {
		if (settled) return;
		settled = true;
		cleanup();
		if (error) rejectRequest(error);
		else resolveRequest();
	};

	const register = async <T>(
		eventName: string,
		handler: AiGenerationListener<T>,
	) => {
		const unlisten = await listen<T>(eventName, handler);
		if (settled) unlisten();
		else unlisteners.add(unlisten);
	};

	void Promise.all([
		register<AiChunkPayload>("ai-chunk", (event) => {
			if (event.payload.session_id === sessionId) onChunk(event.payload.chunk);
		}),
		register<AiDonePayload>("ai-done", (event) => {
			if (event.payload.session_id !== sessionId) return;
			try {
				onComplete(event.payload.full_response);
				finish();
			} catch (error) {
				finish(error instanceof Error ? error : new Error(String(error)));
			}
		}),
		register<AiErrorPayload>("ai-error", (event) => {
			if (event.payload.session_id === sessionId)
				finish(new Error(event.payload.error));
		}),
	])
		.then(() => {
			if (!settled) return invoke("generate_sql", invokeArgs);
		})
		.catch((error) =>
			finish(error instanceof Error ? error : new Error(String(error))),
		);

	return { promise, cancel: finish };
}
