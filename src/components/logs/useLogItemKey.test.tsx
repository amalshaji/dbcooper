import { afterEach, describe, expect, test } from "bun:test";
import { GlobalRegistrator } from "@happy-dom/global-registrator";
import { StrictMode, type PropsWithChildren } from "react";
import type { LogEntry } from "../../lib/logs";
import { useLogItemKey } from "./useLogItemKey";

if (!globalThis.document) GlobalRegistrator.register();

const { cleanup, renderHook } = await import("@testing-library/react");

const entries: LogEntry[] = [
	{
		id: "line-1",
		kind: "line",
		raw: "INFO database ready",
		timestamp: null,
		level: "info",
		message: "database ready",
		context: null,
	},
];

afterEach(() => cleanup());

describe("useLogItemKey", () => {
	test("keeps the extractor stable while the visible entries are unchanged", () => {
		const wrapper = ({ children }: PropsWithChildren) => (
			<StrictMode>{children}</StrictMode>
		);
		const { result, rerender } = renderHook(
			({ visibleEntries }: { visibleEntries: LogEntry[] }) =>
				useLogItemKey(visibleEntries),
			{ initialProps: { visibleEntries: entries }, wrapper },
		);
		const firstExtractor = result.current;

		rerender({ visibleEntries: entries });

		expect(result.current).toBe(firstExtractor);
		expect(result.current(0)).toBe("line-1");
	});
});
