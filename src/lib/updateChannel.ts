export type UpdateChannel = "stable" | "canary";

export const UPDATE_CHANNEL_CHANGED_EVENT = "update-channel-changed";

export function resolveUpdateChannel(
	value: string | null | undefined,
): UpdateChannel {
	return value === "canary" ? "canary" : "stable";
}

export function resolveUpdateChannelEvent(payload: unknown): UpdateChannel {
	return resolveUpdateChannel(typeof payload === "string" ? payload : undefined);
}
