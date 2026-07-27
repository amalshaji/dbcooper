import { afterEach, describe, expect, mock, test } from "bun:test";
import { GlobalRegistrator } from "@happy-dom/global-registrator";
import type { ComponentProps } from "react";

if (!globalThis.document) GlobalRegistrator.register();

mock.module("@/components/ui/badge", () => ({
	Badge: ({ children, ...props }: ComponentProps<"span">) => (
		<span {...props}>{children}</span>
	),
}));
mock.module("@/components/ui/button", () => ({
	Button: ({ children, ...props }: ComponentProps<"button">) => (
		<button {...props}>{children}</button>
	),
}));
mock.module("@/components/ui/spinner", () => ({
	Spinner: () => <span>Loading</span>,
}));
mock.module("@/lib/sqlSafety", () => ({
	classifySqlIntent: () => "read",
}));

const { cleanup, render } = await import("@testing-library/react");
const { SqlAIPreview } = await import("./SqlAIPreview");

afterEach(cleanup);

describe("SqlAIPreview", () => {
	test("uses the standard app border radius", () => {
		const { container } = render(
			<SqlAIPreview
				draft={{ status: "ready", sql: "SELECT 1;" }}
				hasExistingSql={false}
				onReplace={() => {}}
				onAppend={() => {}}
				onDiscard={() => {}}
			/>,
		);

		expect(container.querySelector("section")?.className).toContain(
			"rounded-lg",
		);
	});
});
