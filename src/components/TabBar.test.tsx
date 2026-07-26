import { describe, expect, mock, test } from "bun:test";
import type { ComponentProps } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import type { QueryTab } from "../types/tabTypes";

mock.module("@/components/ui/button", () => ({
	Button: ({
		children,
		variant: _variant,
		size: _size,
		...props
	}: ComponentProps<"button"> & { variant?: string; size?: string }) => (
		<button {...props}>{children}</button>
	),
}));
mock.module("@/components/ui/spinner", () => ({
	Spinner: (props: ComponentProps<"span">) => <span role="status" {...props} />,
}));
mock.module("@/lib/utils", () => ({
	cn: (...values: Array<string | false | null | undefined>) =>
		values.filter(Boolean).join(" "),
}));

const { TabBar } = await import("./TabBar");

const handlers = {
	onTabSelect: () => {},
	onTabClose: () => {},
	onNewQuery: () => {},
};

function createQueryTab(): QueryTab {
	return {
		id: "query-1",
		type: "query",
		title: "New Query",
		query: "",
		ai: { instruction: "", draft: { status: "idle" } },
		savedQueryId: null,
		savedQueryName: null,
		results: null,
		error: null,
		success: false,
		executionTime: null,
		affectedRows: null,
		executing: false,
		filterInput: "",
		filter: "",
		sort: null,
		resultBaseQuery: null,
	};
}

describe("TabBar query generation status", () => {
	test("shows the close button for an idle query tab", () => {
		const tab = createQueryTab();
		const markup = renderToStaticMarkup(
			<TabBar tabs={[tab]} activeTabId={tab.id} {...handlers} />,
		);

		expect(markup).toContain('aria-label="Close New Query"');
	});

	test("shows a spinner on an unfocused query tab while AI is generating", () => {
		const tab = createQueryTab();
		tab.ai.draft = {
			status: "generating",
			requestId: "request-1",
			sql: "",
		};

		const markup = renderToStaticMarkup(
			<TabBar tabs={[tab]} activeTabId={null} {...handlers} />,
		);

		expect(markup).toContain('aria-label="Generating New Query"');
		expect(markup).not.toContain('aria-label="Close New Query"');
	});
});
