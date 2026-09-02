import { describe, expect, mock, test } from "bun:test";
import type { ComponentProps } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import type { LogEntry } from "../../lib/logs";

const logs = await import("../../lib/logs");
mock.module("@/lib/logs", () => logs);
const utils = await import("../../lib/utils");
mock.module("@/lib/utils", () => utils);

mock.module("@/components/ui/button", () => ({
	Button: ({ children, ...props }: ComponentProps<"button">) => (
		<button {...props}>{children}</button>
	),
}));

const { LogLineRow } = await import("./LogLineRow");

describe("LogLineRow", () => {
	test("renders untrusted raw log text as escaped text with a labeled copy action", () => {
		const raw = '<img src=x onerror="alert(1)"> database said no';
		const entry: LogEntry = {
			id: "unsafe-line",
			kind: "line",
			raw,
			timestamp: null,
			level: "unknown",
			message: raw,
			context: null,
		};

		const markup = renderToStaticMarkup(
			<LogLineRow
				entry={entry}
				onCopy={() => undefined}
			/>,
		);

		expect(markup).toContain("&lt;img src=x onerror=&quot;alert(1)&quot;&gt;");
		expect(markup).not.toContain("<img src=x");
		expect(markup).toContain('aria-label="Copy log line"');
	});

	test("uses visible level text in addition to a semantic severity rail", () => {
		const entry: LogEntry = {
			id: "error-line",
			kind: "line",
			raw: "12:00:00 ERROR connection lost",
			timestamp: "12:00:00",
			level: "error",
			message: "connection lost",
			context: null,
		};
		const markup = renderToStaticMarkup(
			<LogLineRow
				entry={entry}
				onCopy={() => undefined}
			/>,
		);

		expect(markup).toContain("ERROR");
		expect(markup).toContain('role="listitem"');
		expect(markup).toContain('data-level="error"');
	});
});
