import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { useCallback, useEffect, useRef, useState } from "react";
import {
	type AiGenerationListener,
	startAiGenerationSession,
} from "@/lib/aiGenerationSession";
import { api } from "@/lib/tauri";

interface TableSchema {
	schema: string;
	name: string;
	columns?: Array<{ name: string; type: string; nullable: boolean }>;
}

export function useAIGeneration() {
	const [generating, setGenerating] = useState(false);
	const [error, setError] = useState<string | null>(null);
	const [isConfigured, setIsConfigured] = useState<boolean | null>(null);
	const activeRequestRef = useRef<ReturnType<
		typeof startAiGenerationSession
	> | null>(null);

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
			const request = activeRequestRef.current;
			activeRequestRef.current = null;
			request?.cancel(new Error("AI generation was cancelled"));
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
			const previousRequest = activeRequestRef.current;
			activeRequestRef.current = null;
			previousRequest?.cancel(
				new Error("A newer AI request replaced this one"),
			);
			setGenerating(true);
			setError(null);

			const sessionId = `ai-${Date.now()}-${crypto.randomUUID()}`;
			const request = startAiGenerationSession({
				sessionId,
				listen: <T>(eventName: string, handler: AiGenerationListener<T>) =>
					listen<T>(eventName, (event) => handler(event)),
				invoke: (command, args) => invoke(command, args),
				invokeArgs: {
					sessionId,
					dbType,
					instruction,
					existingSql: existingSQL,
					tables,
				},
				onChunk: onStream,
				onComplete: (sql) => onComplete?.(sql),
			});
			activeRequestRef.current = request;

			try {
				await request.promise;
			} catch (requestError) {
				if (activeRequestRef.current === request) {
					setError(
						requestError instanceof Error
							? requestError.message
							: String(requestError),
					);
				}
				throw requestError;
			} finally {
				if (activeRequestRef.current === request) {
					activeRequestRef.current = null;
					setGenerating(false);
				}
			}
		},
		[],
	);

	return { generateSQL, generating, error, isConfigured };
}
