export type UpdateChannel = "stable" | "canary";

export function resolveUpdateChannel(
	value: string | null | undefined,
): UpdateChannel {
	return value === "canary" ? "canary" : "stable";
}
