import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { useCallback, useEffect, useRef, useState } from "react";
import {
	type AiGenerationListener,
	AiGenerationSessionRegistry,
	startAiGenerationSession,
} from "@/lib/aiGenerationSession";
import { api } from "@/lib/tauri";

interface TableSchema {
	schema: string;
	name: string;
	columns?: Array<{ name: string; type: string; nullable: boolean }>;
}

export function useAIGeneration() {
	const [isConfigured, setIsConfigured] = useState<boolean | null>(null);
	const activeRequestsRef = useRef(new AiGenerationSessionRegistry());

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
			activeRequestsRef.current.cancelAll();
		},
		[],
	);

	const generateSQL = useCallback(
		async (
			requestKey: string,
			dbType: string,
			instruction: string,
			existingSQL: string,
			tables: TableSchema[],
			onStream: (chunk: string) => void,
			onComplete?: (sql: string) => void,
		) => {
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
			activeRequestsRef.current.replace(requestKey, request);

			try {
				await request.promise;
			} finally {
				activeRequestsRef.current.deleteIfCurrent(requestKey, request);
			}
		},
		[],
	);

	const cancelGeneration = useCallback((requestKey: string) => {
		activeRequestsRef.current.cancel(requestKey);
	}, []);

	return { generateSQL, cancelGeneration, isConfigured };
}
