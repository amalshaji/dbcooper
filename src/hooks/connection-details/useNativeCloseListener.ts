import { listen } from "@tauri-apps/api/event";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { useEffect, useEffectEvent } from "react";

type NativeCloseTarget =
	| { kind: "window" }
	| {
			kind: "tabs";
			activeTabId: string | null;
			closeTab: (tabId: string) => void;
	  };

export function useNativeCloseListener(
	target: NativeCloseTarget,
	enabled: boolean = true,
) {
	const handleNativeCloseTab = useEffectEvent(() => {
		if (target.kind === "window" || target.activeTabId === null) {
			void getCurrentWindow().close();
		} else {
			target.closeTab(target.activeTabId);
		}
	});

	useEffect(() => {
		if (!enabled) return;
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
	}, [enabled]);
}
