import { Channel } from "@tauri-apps/api/core";
import { useCallback, useEffect, useRef, useState } from "react";
import {
	appendToLogBuffer,
	getObservabilityCapabilities,
	normalizeObservabilityEvent,
	startObservabilityStream,
	stopObservabilityStream,
	type LogEntry,
	type ObservabilityMode,
	type ObservabilitySourceCapability,
} from "@/lib/logs";

export type ObservabilityStreamStatus =
	| "idle"
	| "starting"
	| "streaming"
	| "stopped"
	| "error";

interface StreamState {
	key: string;
	entries: LogEntry[];
	status: ObservabilityStreamStatus;
	error: string | null;
}

interface PendingDelivery {
	behavior: "append" | "replace";
	entries: LogEntry[];
}

export function useObservabilityCapabilities(connectionUuid: string) {
	const [capabilities, setCapabilities] = useState<
		ObservabilitySourceCapability[]
	>([]);
	const [loading, setLoading] = useState(true);
	const [error, setError] = useState<string | null>(null);
	const revisionRef = useRef(0);

	const refresh = useCallback(async () => {
		const revision = ++revisionRef.current;
		setLoading(true);
		setError(null);
		try {
			const next = await getObservabilityCapabilities(connectionUuid);
			if (revision === revisionRef.current) setCapabilities(next);
		} catch (reason) {
			if (revision === revisionRef.current) {
				setCapabilities([]);
				setError(reason instanceof Error ? reason.message : String(reason));
			}
		} finally {
			if (revision === revisionRef.current) setLoading(false);
		}
	}, [connectionUuid]);

	useEffect(() => {
		void refresh();
		return () => {
			revisionRef.current += 1;
		};
	}, [refresh]);

	return { capabilities, loading, error, refresh };
}

interface UseObservabilityStreamOptions {
	connectionUuid: string;
	mode: ObservabilityMode;
	source: string | null;
	enabled: boolean;
}

export function useObservabilityStream({
	connectionUuid,
	mode,
	source,
	enabled,
}: UseObservabilityStreamOptions) {
	const [revision, setRevision] = useState(0);
	const streamKey = `${connectionUuid}:${mode}:${source ?? "none"}:${enabled}:${revision}`;
	const [streamState, setStreamState] = useState<StreamState>({
		key: "",
		entries: [],
		status: "idle",
		error: null,
	});
	const cancelPendingRef = useRef<() => void>(() => undefined);

	useEffect(() => {
		if (!enabled || !source) return;

		let active = true;
		let streamId: string | null = null;
		let terminalEventReceived = false;
		let pendingFrame: number | null = null;
		let pendingDeliveries: PendingDelivery[] = [];
		const onEvent = new Channel<unknown>();
		const flushEntries = () => {
			pendingFrame = null;
			if (
				!active ||
				terminalEventReceived ||
				pendingDeliveries.length === 0
			) {
				pendingDeliveries = [];
				return;
			}
			const deliveries = pendingDeliveries;
			pendingDeliveries = [];
			setStreamState((current) => {
				let entries = current.key === streamKey ? current.entries : [];
				for (const delivery of deliveries) {
					entries =
						delivery.behavior === "replace"
							? appendToLogBuffer([], delivery.entries)
							: appendToLogBuffer(entries, delivery.entries);
				}
				return {
					key: streamKey,
					entries,
					status: "streaming",
					error: current.key === streamKey ? current.error : null,
				};
			});
		};
		const queueEntries = (
			entries: LogEntry[],
			behavior: PendingDelivery["behavior"],
		) => {
			pendingDeliveries.push({ behavior, entries });
			if (pendingFrame === null) {
				pendingFrame = requestAnimationFrame(flushEntries);
			}
		};
		const cancelPendingEntries = () => {
			if (pendingFrame !== null) cancelAnimationFrame(pendingFrame);
			pendingFrame = null;
			pendingDeliveries = [];
		};
		cancelPendingRef.current = cancelPendingEntries;

		onEvent.onmessage = (payload) => {
			if (!active) return;
			const event = normalizeObservabilityEvent(payload);
			if (!event || (streamId && event.streamId !== streamId)) return;
			switch (event.type) {
				case "snapshot":
					queueEntries(
						event.entries,
						mode === "activity" ? "replace" : "append",
					);
					break;
				case "error": {
					if (!event.recoverable) {
						terminalEventReceived = true;
						cancelPendingEntries();
					}
					setStreamState((current) => ({
						key: streamKey,
						entries: current.key === streamKey ? current.entries : [],
						status: event.recoverable ? "streaming" : "error",
						error: event.message,
					}));
					break;
				}
				case "stopped":
					terminalEventReceived = true;
					cancelPendingEntries();
					setStreamState((current) => ({
						key: streamKey,
						entries: current.key === streamKey ? current.entries : [],
						status: "stopped",
						error:
							event.reason === "disconnected"
								? "The connection closed. Reconnect to resume live activity."
								: current.key === streamKey
									? current.error
									: null,
					}));
					break;
			}
		};

		void startObservabilityStream({
			connectionUuid,
			mode,
			source,
			onEvent,
		})
			.then((response) => {
				streamId = response.streamId;
				if (!active) {
					void stopObservabilityStream(response.streamId);
					return;
				}
				if (!terminalEventReceived) {
					setStreamState((current) => ({
						key: streamKey,
						entries: current.key === streamKey ? current.entries : [],
						status: "streaming",
						error: null,
					}));
				}
			})
			.catch((reason) => {
				if (!active) return;
				setStreamState({
					key: streamKey,
					entries: [],
					status: "error",
					error: reason instanceof Error ? reason.message : String(reason),
				});
			});

		return () => {
			active = false;
			cancelPendingEntries();
			if (cancelPendingRef.current === cancelPendingEntries) {
				cancelPendingRef.current = () => undefined;
			}
			onEvent.onmessage = () => undefined;
			setStreamState((current) =>
				current.key === streamKey
					? { key: streamKey, entries: [], status: "idle", error: null }
					: current,
			);
			if (streamId) void stopObservabilityStream(streamId);
		};
	}, [
		connectionUuid,
		enabled,
		mode,
		revision,
		source,
		streamKey,
	]);
	const currentState =
		streamState.key === streamKey
			? streamState
			: {
					key: streamKey,
					entries: [],
					status: enabled && source ? ("starting" as const) : ("idle" as const),
					error: null,
				};

	return {
		entries: currentState.entries,
		status: currentState.status,
		error: currentState.error,
		clear: () => {
			cancelPendingRef.current();
			setStreamState((current) =>
				current.key === streamKey ? { ...current, entries: [] } : current,
			);
		},
		retry: () => setRevision((current) => current + 1),
	};
}
