import { useCallback } from "react";
import type { LogEntry } from "../../lib/logs";

export function useLogItemKey(entries: readonly LogEntry[]) {
	return useCallback(
		(index: number) => entries[index]?.id ?? index,
		[entries],
	);
}
