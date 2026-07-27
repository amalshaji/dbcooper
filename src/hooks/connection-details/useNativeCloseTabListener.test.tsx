import { afterEach, beforeEach, expect, mock, test } from "bun:test";
import { GlobalRegistrator } from "@happy-dom/global-registrator";

if (!globalThis.document) GlobalRegistrator.register();

function deferred<T>() {
	let resolve: (value: T) => void = () => {};
	const promise = new Promise<T>((complete) => {
		resolve = complete;
	});
	return { promise, resolve };
}

let listenerRegistration = deferred<() => void>();
let registeredListener: (() => void) | undefined;
let cleanupCalls = 0;
let windowCloseCalls = 0;

mock.module("@tauri-apps/api/event", () => ({
	listen: async (_event: string, listener: () => void) => {
		registeredListener = listener;
		return listenerRegistration.promise;
	},
}));

mock.module("@tauri-apps/api/window", () => ({
	getCurrentWindow: () => ({
		close: async () => {
			windowCloseCalls += 1;
		},
	}),
}));

const { act, cleanup, renderHook, waitFor } = await import(
	"@testing-library/react"
);
const { useNativeCloseTabListener } = await import(
	"./useNativeCloseTabListener"
);

beforeEach(() => {
	listenerRegistration = deferred<() => void>();
	registeredListener = undefined;
	cleanupCalls = 0;
	windowCloseCalls = 0;
});

afterEach(cleanup);

test("uses the latest active tab and releases the native listener", async () => {
	const closedTabs: string[] = [];
	const closeTab = (tabId: string) => closedTabs.push(tabId);
	const { rerender, unmount } = renderHook(
		({ activeTabId }: { activeTabId: string | null }) =>
			useNativeCloseTabListener(activeTabId, closeTab),
		{ initialProps: { activeTabId: "tab-1" } },
	);

	listenerRegistration.resolve(() => {
		cleanupCalls += 1;
	});
	await listenerRegistration.promise;
	expect(registeredListener).toBeDefined();
	act(() => registeredListener?.());
	rerender({ activeTabId: "tab-2" });
	act(() => registeredListener?.());
	unmount();

	expect(closedTabs).toEqual(["tab-1", "tab-2"]);
	await waitFor(() => expect(cleanupCalls).toBe(1));
});

test("cleans up when registration finishes after unmount", async () => {
	const { unmount } = renderHook(() =>
		useNativeCloseTabListener("tab-1", () => {}),
	);

	unmount();
	listenerRegistration.resolve(() => {
		cleanupCalls += 1;
	});
	await listenerRegistration.promise;
	await waitFor(() => expect(cleanupCalls).toBe(1));
});

test("closes the window when the active route has no SQL tab", async () => {
	const { unmount } = renderHook(() =>
		useNativeCloseTabListener(null, () => {}),
	);
	listenerRegistration.resolve(() => {
		cleanupCalls += 1;
	});
	await listenerRegistration.promise;
	await waitFor(() => expect(registeredListener).toBeDefined());

	act(() => registeredListener?.());
	await waitFor(() => expect(windowCloseCalls).toBe(1));
	unmount();
});

test("does not double-register when the SQL workspace owns native close", () => {
	renderHook(() => useNativeCloseTabListener(null, () => {}, false));
	expect(registeredListener).toBeUndefined();
});
