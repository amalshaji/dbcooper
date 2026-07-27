import { listen } from "@tauri-apps/api/event";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { useEffect, useEffectEvent } from "react";

export function useNativeCloseTabListener(
	activeTabId: string | null,
	closeTab: (tabId: string) => void,
) {
	const handleNativeCloseTab = useEffectEvent(() => {
		if (activeTabId) {
			closeTab(activeTabId);
		} else {
			void getCurrentWindow().close();
		}
	});

	useEffect(() => {
		let mounted = true;
		let unlisten: (() => void) | undefined;

		void listen("menu:close-tab", handleNativeCloseTab).then((cleanup) => {
			if (mounted) {
				unlisten = cleanup;
			} else {
				cleanup();
			}
		});

		return () => {
			mounted = false;
			unlisten?.();
		};
	}, []);
}
