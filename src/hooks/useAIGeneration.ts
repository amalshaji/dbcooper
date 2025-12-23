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
let listenerResolve: (() => void) | null = null;
let listenerReject: ((error: Error) => void) | null = null;
let listenersSetup = false;

async function setupGlobalListeners() {
  if (listenersSetup) return;
  listenersSetup = true;

  globalUnlistenChunk = await listen<AiChunkPayload>("ai-chunk", (event) => {
    if (event.payload.session_id === listenerSessionId && listenerOnStream) {
      listenerOnStream(event.payload.chunk);
    }
  });

  globalUnlistenDone = await listen<AiDonePayload>("ai-done", (event) => {
    if (event.payload.session_id === listenerSessionId) {
      listenerSessionId = null;
      if (listenerResolve) {
        listenerResolve();
        listenerResolve = null;
      }
    }
  });

  globalUnlistenError = await listen<AiErrorPayload>("ai-error", (event) => {
    if (event.payload.session_id === listenerSessionId) {
      listenerSessionId = null;
      if (listenerReject) {
        listenerReject(new Error(event.payload.error));
        listenerReject = null;
      }
    }
  });
}

export function useAIGeneration() {
  const [generating, setGenerating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [isConfigured, setIsConfigured] = useState<boolean | null>(null);

  useEffect(() => {
    const checkConfig = async () => {
      try {
        const settings = await api.settings.getAll();
        const hasKey = !!settings.openai_api_key;
        setIsConfigured(hasKey);
      } catch {
        setIsConfigured(false);
      }
    };
    checkConfig();
  }, []);

  useEffect(() => {
    setupGlobalListeners();
    // Don't cleanup global listeners since they're shared
  }, []);

  const generateSQL = useCallback(async (
    dbType: string,
    instruction: string,
    existingSQL: string,
    tables: TableSchema[],
    onStream: (chunk: string) => void
  ) => {
    setGenerating(true);
    setError(null);

    const sessionId = `ai-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
    listenerSessionId = sessionId;
    listenerOnStream = onStream;

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
        setGenerating(false);
        setError(err instanceof Error ? err.message : String(err));
        reject(err);
      });
    });
  }, []);

  return { generateSQL, generating, error, isConfigured };
}
