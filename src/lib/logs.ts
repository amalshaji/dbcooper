import { type Channel, invoke } from "@tauri-apps/api/core";

export const LOG_BUFFER_LIMIT = 2_000;
export const LOG_SNAPSHOT_LIMIT = 200;

export type ObservabilityMode = "logs" | "activity";
export type LogLevel =
	| "trace"
	| "debug"
	| "info"
	| "warn"
	| "error"
	| "fatal"
	| "unknown";
export type ObservabilityEntryKind = "line" | "activity";
export type ObservabilityAvailability =
	| "available"
	| "degraded"
	| "unavailable";

export interface LogEntry {
	id: string;
	kind: ObservabilityEntryKind;
	raw: string;
	timestamp: string | null;
	level: LogLevel;
	message: string;
	context: string | null;
}

export interface ObservabilitySourceCapability {
	id: string;
	label: string;
	modes: ObservabilityMode[];
	availability: ObservabilityAvailability;
	reason: string | null;
}

export interface StartObservabilityStreamRequest {
	connectionUuid: string;
	mode: ObservabilityMode;
	source: string;
	onEvent: Channel<unknown>;
}

export interface StartObservabilityStreamResponse {
	streamId: string;
}

export type ObservabilityStreamEvent =
	| { type: "snapshot"; streamId: string; entries: LogEntry[] }
	| {
			type: "error";
			streamId: string | null;
			code: string;
			message: string;
			recoverable: boolean;
	  }
	| {
			type: "stopped";
			streamId: string;
			reason: "requested" | "disconnected" | "source-ended";
	  };
export function appendToLogBuffer(
	current: LogEntry[],
	incoming: LogEntry | LogEntry[],
): LogEntry[] {
	const combined = current.concat(incoming);
	const seen = new Set<string>();
	const newestFirst: LogEntry[] = [];
	for (let index = combined.length - 1; index >= 0; index -= 1) {
		const entry = combined[index];
		if (seen.has(entry.id)) continue;
		seen.add(entry.id);
		newestFirst.push(entry);
		if (newestFirst.length === LOG_BUFFER_LIMIT) break;
	}
	return newestFirst.reverse();
}

export function filterLogEntries(
	entries: LogEntry[],
	search: string,
	levels: ReadonlySet<LogLevel>,
): LogEntry[] {
	const normalizedSearch = search.trim().toLocaleLowerCase();
	return entries.filter(
		(entry) =>
			(levels.size === 0 || levels.has(entry.level)) &&
			(!normalizedSearch ||
				entry.raw.toLocaleLowerCase().includes(normalizedSearch)),
	);
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null;
}

function isLogLevel(value: unknown): value is LogLevel {
	return (
		typeof value === "string" &&
		["trace", "debug", "info", "warn", "error", "fatal", "unknown"].includes(
			value,
		)
	);
}

function normalizeEntry(value: unknown) {
	if (
		!isRecord(value) ||
		typeof value.id !== "string" ||
		typeof value.raw !== "string" ||
		(value.kind !== "line" && value.kind !== "activity") ||
		(value.timestamp !== null && typeof value.timestamp !== "string") ||
		!isLogLevel(value.level) ||
		typeof value.message !== "string" ||
		(value.context !== null && typeof value.context !== "string")
	) {
		return null;
	}
	return {
		id: value.id,
		kind: value.kind,
		raw: value.raw,
		timestamp: value.timestamp,
		level: value.level,
		message: value.message,
		context: value.context,
	};
}

function normalizeCapability(value: unknown): ObservabilitySourceCapability | null {
	if (
		!isRecord(value) ||
		typeof value.id !== "string" ||
		typeof value.label !== "string" ||
		!Array.isArray(value.modes)
	) {
		return null;
	}
	const modes = value.modes.filter(
		(mode): mode is ObservabilityMode => mode === "logs" || mode === "activity",
	);
	const availability =
		value.availability === "available" || value.availability === "degraded"
			? value.availability
			: "unavailable";
	return {
		id: value.id,
		label: value.label,
		modes,
		availability,
		reason: typeof value.reason === "string" ? value.reason : null,
	};
}

export function normalizeObservabilityCapabilities(
	value: unknown,
): ObservabilitySourceCapability[] {
	if (!Array.isArray(value)) return [];
	return value
		.map(normalizeCapability)
		.filter(
			(capability): capability is ObservabilitySourceCapability =>
				capability !== null,
		);
}

export function normalizeObservabilityEvent(
	value: unknown,
): ObservabilityStreamEvent | null {
	if (!isRecord(value) || typeof value.type !== "string") return null;
	if (value.type === "snapshot") {
		if (!Array.isArray(value.entries) || typeof value.streamId !== "string") {
			return null;
		}
		const entries = value.entries
			.map(normalizeEntry)
			.filter((entry): entry is LogEntry => entry !== null);
		return { type: "snapshot", streamId: value.streamId, entries };
	}
	if (value.type === "error") {
		if (typeof value.code !== "string" || typeof value.message !== "string") {
			return null;
		}
		return {
			type: "error",
			streamId: typeof value.streamId === "string" ? value.streamId : null,
			code: value.code,
			message: value.message,
			recoverable: value.recoverable === true,
		};
	}
	if (value.type === "stopped") {
		if (typeof value.streamId !== "string") return null;
		const reason =
			value.reason === "disconnected" || value.reason === "source-ended"
				? value.reason
				: "requested";
		return { type: "stopped", streamId: value.streamId, reason };
	}
	return null;
}

export function startObservabilityStream(
	request: StartObservabilityStreamRequest,
): Promise<StartObservabilityStreamResponse> {
	return invoke<unknown>("start_observability_stream", { ...request }).then((value) => {
		if (!isRecord(value) || typeof value.streamId !== "string") {
			throw new Error("The observability stream returned an invalid response.");
		}
		return {
			streamId: value.streamId,
		};
	});
}

export function stopObservabilityStream(streamId: string): Promise<void> {
	return invoke("stop_observability_stream", { streamId });
}

export function getObservabilityCapabilities(
	connectionUuid: string,
): Promise<ObservabilitySourceCapability[]> {
	return invoke<unknown>("get_observability_capabilities", {
		connectionUuid,
	}).then(normalizeObservabilityCapabilities);
}
