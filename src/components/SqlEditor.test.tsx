import { afterEach, expect, mock, test } from "bun:test";
import { GlobalRegistrator } from "@happy-dom/global-registrator";
import type { ComponentProps, ReactNode } from "react";

if (!globalThis.document) GlobalRegistrator.register();

mock.module("@codemirror/lang-sql", () => ({ sql: () => ({}) }));
mock.module("@codemirror/state", () => ({
	EditorState: { readOnly: { of: () => ({}) } },
	Prec: { highest: (value: unknown) => value },
}));
mock.module("@codemirror/view", () => ({
	EditorView: {
		lineWrapping: {},
		theme: () => ({}),
		updateListener: { of: () => ({}) },
	},
	keymap: { of: () => ({}) },
}));
mock.module("@uiw/react-codemirror", () => ({
	default: ({ value }: { value: string }) => <div>{value}</div>,
}));
mock.module("thememirror", () => ({ barf: {}, rosePineDawn: {} }));
mock.module("@/lib/aiDraftState", () => ({
	initialAiDraftState: { status: "idle" },
	aiDraftReducer: (state: unknown) => state,
}));
mock.module("@/components/SqlAIPreview", () => ({
	SqlAIPreview: ({
		draft,
	}: {
		draft: { status: string; sql?: string; message?: string };
	}) => <div data-testid="ai-draft">{draft.sql ?? draft.message}</div>,
}));
mock.module("@/components/ui/button", () => ({
	Button: ({ children, ...props }: ComponentProps<"button">) => (
		<button {...props}>{children}</button>
	),
}));
mock.module("@/components/ui/input", () => ({
	Input: (props: ComponentProps<"input">) => <input {...props} />,
}));
mock.module("@/components/ui/spinner", () => ({ Spinner: () => <span /> }));
mock.module("@/components/ui/tooltip", () => ({
	Tooltip: ({ children }: { children: ReactNode }) => <>{children}</>,
	TooltipContent: ({ children }: { children: ReactNode }) => <>{children}</>,
	TooltipTrigger: ({ children }: { children: ReactNode }) => <>{children}</>,
}));

const { cleanup, render, screen } = await import("@testing-library/react");
const { SqlEditor } = await import("./SqlEditor");

afterEach(cleanup);

test("renders the AI prompt and draft owned by the selected query tab", () => {
	const commonProps = {
		value: "SELECT * FROM users",
		onChange: () => {},
		tables: [{ schema: "public", name: "users" }],
		onGenerateSQL: async () => "SELECT * FROM users",
		onAiStateChange: () => {},
	};
	const { rerender } = render(
		<SqlEditor
			{...commonProps}
			aiState={{
				instruction: "List active users",
				draft: { status: "generating", sql: "SELECT *" },
			}}
		/>,
	);

	expect(
		(screen.getByPlaceholderText("Ask for a query or change…") as HTMLInputElement)
			.value,
	).toBe("List active users");
	expect(screen.getByTestId("ai-draft").textContent).toBe("SELECT *");

	rerender(
		<SqlEditor
			{...commonProps}
			aiState={{ instruction: "", draft: { status: "idle" } }}
		/>,
	);
	expect(screen.queryByTestId("ai-draft")).toBeNull();

	rerender(
		<SqlEditor
			{...commonProps}
			aiState={{
				instruction: "List active users",
				draft: {
					status: "ready",
					sql: "SELECT * FROM users WHERE active = true",
				},
			}}
		/>,
	);
	expect(screen.getByTestId("ai-draft").textContent).toContain(
		"WHERE active = true",
	);
});
