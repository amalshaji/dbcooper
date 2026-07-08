import { useState, useEffect, useCallback } from "react";
import { api } from "@/lib/tauri";
import { invoke } from "@tauri-apps/api/core";
import { listen, UnlistenFn } from "@tauri-apps/api/event";

interface TableSchema {
	schema: string;
	name: string;
	columns?: Array<{
		name: string;
		type: string;
		nullable: boolean;
	}>;
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

// Global listener management to prevent duplicates in React Strict Mode
let globalUnlistenChunk: UnlistenFn | null = null;
let globalUnlistenDone: UnlistenFn | null = null;
let globalUnlistenError: UnlistenFn | null = null;
let listenerSessionId: string | null = null;
let listenerOnStream: ((chunk: string) => void) | null = null;
let listenerOnComplete: ((sql: string) => void) | null = null;
let listenerResolve: (() => void) | null = null;
let listenerReject: ((error: Error) => void) | null = null;
let listenersPromise: Promise<void> | null = null;

async function setupGlobalListeners() {
	if (listenersPromise) return listenersPromise;

	listenersPromise = (async () => {
		globalUnlistenChunk = await listen<AiChunkPayload>("ai-chunk", (event) => {
			if (event.payload.session_id === listenerSessionId && listenerOnStream) {
				listenerOnStream(event.payload.chunk);
			}
		});

		globalUnlistenDone = await listen<AiDonePayload>("ai-done", (event) => {
			if (event.payload.session_id === listenerSessionId) {
				try {
					listenerOnComplete?.(event.payload.full_response);
				} catch (err) {
					console.error("Failed to apply generated SQL:", err);
				}
				listenerSessionId = null;
				listenerOnStream = null;
				listenerOnComplete = null;
				if (listenerResolve) {
					listenerResolve();
					listenerResolve = null;
				}
			}
		});

		globalUnlistenError = await listen<AiErrorPayload>("ai-error", (event) => {
			if (event.payload.session_id === listenerSessionId) {
				listenerSessionId = null;
				listenerOnStream = null;
				listenerOnComplete = null;
				if (listenerReject) {
					listenerReject(new Error(event.payload.error));
					listenerReject = null;
				}
			}
		});
	})().catch((error) => {
		listenersPromise = null;
		globalUnlistenChunk?.();
		globalUnlistenDone?.();
		globalUnlistenError?.();
		globalUnlistenChunk = null;
		globalUnlistenDone = null;
		globalUnlistenError = null;
		throw error;
	});

	return listenersPromise;
}

export function useAIGeneration() {
	const [generating, setGenerating] = useState(false);
	const [error, setError] = useState<string | null>(null);
	const [isConfigured, setIsConfigured] = useState<boolean | null>(null);

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

	useEffect(() => {
		void setupGlobalListeners().catch((err) => {
			console.error("Failed to set up AI listeners:", err);
		});
		// Don't cleanup global listeners since they're shared
	}, []);

	const generateSQL = useCallback(
		async (
			dbType: string,
			instruction: string,
			existingSQL: string,
			tables: TableSchema[],
			onStream: (chunk: string) => void,
			onComplete?: (sql: string) => void,
		) => {
			setGenerating(true);
			setError(null);
			try {
				await setupGlobalListeners();
			} catch (err) {
				const message = err instanceof Error ? err.message : String(err);
				setGenerating(false);
				setError(message);
				throw err;
			}

			const sessionId = `ai-${Date.now()}-${Math.random().toString(36).slice(2, 11)}`;
			listenerSessionId = sessionId;
			listenerOnStream = onStream;
			listenerOnComplete = onComplete ?? null;

			return new Promise<void>((resolve, reject) => {
				listenerResolve = () => {
					setGenerating(false);
					resolve();
				};
				listenerReject = (err) => {
					setGenerating(false);
					setError(err.message);
					reject(err);
				};

				invoke("generate_sql", {
					sessionId,
					dbType,
					instruction,
					existingSql: existingSQL,
					tables,
				}).catch((err) => {
					listenerSessionId = null;
					listenerOnStream = null;
					listenerOnComplete = null;
					setGenerating(false);
					setError(err instanceof Error ? err.message : String(err));
					reject(err);
				});
			});
		},
		[],
	);

	return { generateSQL, generating, error, isConfigured };
}
