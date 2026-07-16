import { useCallback, useEffect, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import { api } from "@/lib/tauri";

interface TableSchema {
	schema: string;
	name: string;
	columns?: Array<{ name: string; type: string; nullable: boolean }>;
}

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

export function useAIGeneration() {
	const [generating, setGenerating] = useState(false);
	const [error, setError] = useState<string | null>(null);
	const [isConfigured, setIsConfigured] = useState<boolean | null>(null);
	const activeSessionRef = useRef<string | null>(null);
	const cleanupRef = useRef<() => void>(() => undefined);
	const rejectRef = useRef<((error: Error) => void) | null>(null);

	useEffect(() => {
		const checkConfig = async () => {
			try {
				const status = await api.ai.getStatus();
				setIsConfigured(status.configured);
			} catch {
				setIsConfigured(false);
			}
		};

		void checkConfig();
		window.addEventListener("ai-settings-changed", checkConfig);
		return () => window.removeEventListener("ai-settings-changed", checkConfig);
	}, []);

	useEffect(
		() => () => {
			rejectRef.current?.(new Error("AI generation was cancelled"));
			cleanupRef.current();
		},
		[],
	);

	const generateSQL = useCallback(
		async (
			dbType: string,
			instruction: string,
			existingSQL: string,
			tables: TableSchema[],
			onStream: (chunk: string) => void,
			onComplete?: (sql: string) => void,
		) => {
			rejectRef.current?.(new Error("A newer AI request replaced this one"));
			cleanupRef.current();
			setGenerating(true);
			setError(null);

			const sessionId = `ai-${Date.now()}-${crypto.randomUUID()}`;
			activeSessionRef.current = sessionId;

			return new Promise<void>((resolve, reject) => {
				const unlisteners: UnlistenFn[] = [];
				let settled = false;

				const cleanup = () => {
					for (const unlisten of unlisteners) unlisten();
					if (activeSessionRef.current === sessionId) {
						activeSessionRef.current = null;
						rejectRef.current = null;
						setGenerating(false);
					}
				};

				const finish = (requestError?: Error) => {
					if (settled) return;
					settled = true;
					cleanup();
					if (requestError) {
						setError(requestError.message);
						reject(requestError);
					} else {
						resolve();
					}
				};

				rejectRef.current = (requestError) => finish(requestError);
				cleanupRef.current = cleanup;

				void Promise.all([
					listen<AiChunkPayload>("ai-chunk", (event) => {
						if (event.payload.session_id === sessionId)
							onStream(event.payload.chunk);
					}),
					listen<AiDonePayload>("ai-done", (event) => {
						if (event.payload.session_id !== sessionId) return;
						try {
							onComplete?.(event.payload.full_response);
							finish();
						} catch (completionError) {
							finish(
								completionError instanceof Error
									? completionError
									: new Error(String(completionError)),
							);
						}
					}),
					listen<AiErrorPayload>("ai-error", (event) => {
						if (event.payload.session_id === sessionId)
							finish(new Error(event.payload.error));
					}),
				])
					.then((registeredListeners) => {
						unlisteners.push(...registeredListeners);
						if (settled || activeSessionRef.current !== sessionId) {
							cleanup();
							return;
						}
						return invoke("generate_sql", {
							sessionId,
							dbType,
							instruction,
							existingSql: existingSQL,
							tables,
						});
					})
					.catch((requestError) =>
						finish(
							requestError instanceof Error
								? requestError
								: new Error(String(requestError)),
						),
					);
			});
		},
		[],
	);

	return { generateSQL, generating, error, isConfigured };
}
