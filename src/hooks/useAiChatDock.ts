import { useCallback, useEffect, useState } from "react";

const OPEN_STORAGE_KEY = "dbcooper.aiChat.open";

export function useAiChatDock(enabled: boolean) {
	const [open, setOpen] = useState(
		() => localStorage.getItem(OPEN_STORAGE_KEY) === "true",
	);

	useEffect(() => {
		localStorage.setItem(OPEN_STORAGE_KEY, String(open));
	}, [open]);

	const toggle = useCallback(() => setOpen((current) => !current), []);
	const close = useCallback(() => setOpen(false), []);

	useEffect(() => {
		if (!enabled) return;
		const handleKeyDown = (event: KeyboardEvent) => {
			const target = event.target instanceof Element ? event.target : null;
			if (
				event.defaultPrevented ||
				target?.closest(".cm-editor, [role='dialog'], [role='alertdialog']")
			) {
				return;
			}
			if (
				event.key.toLowerCase() === "i" &&
				(event.metaKey || event.ctrlKey) &&
				!event.shiftKey &&
				!event.altKey
			) {
				event.preventDefault();
				toggle();
			}
		};
		window.addEventListener("keydown", handleKeyDown);
		return () => window.removeEventListener("keydown", handleKeyDown);
	}, [enabled, toggle]);

	return { enabled, open: enabled && open, toggle, close };
}

export type AiChatDockController = ReturnType<typeof useAiChatDock>;
