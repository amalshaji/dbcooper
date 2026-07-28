import { afterEach, expect, mock, test } from "bun:test";
import { GlobalRegistrator } from "@happy-dom/global-registrator";
import type { ComponentProps, ReactNode } from "react";

if (!globalThis.document) GlobalRegistrator.register();

mock.module("@uiw/react-codemirror", () => ({
	default: ({
		value,
		onChange,
		editable,
		placeholder,
	}: {
		value: string;
		onChange: (value: string) => void;
		editable: boolean;
		placeholder?: string;
	}) => (
		<textarea
			data-testid="ai-draft-editor"
			value={value}
			readOnly={!editable}
			placeholder={placeholder}
			onChange={(event) => onChange(event.target.value)}
		/>
	),
}));
mock.module("@/components/ui/badge", () => ({
	Badge: ({ children }: { children: ReactNode }) => <span>{children}</span>,
}));
mock.module("@/components/ui/button", () => ({
	Button: ({ children, ...props }: ComponentProps<"button">) => (
		<button {...props}>{children}</button>
	),
}));
mock.module("@/components/ui/spinner", () => ({
	Spinner: () => <span data-testid="spinner" />,
}));
mock.module("@/lib/sqlSafety", () => ({
	classifySqlIntent: () => "read",
}));
mock.module("thememirror", () => ({ barf: {}, rosePineDawn: {} }));

const { cleanup, fireEvent, render, screen } = await import(
	"@testing-library/react"
);
const { SqlAIPreview } = await import("./SqlAIPreview");

afterEach(cleanup);

test("uses the standard app border radius", () => {
	const { container } = render(
		<SqlAIPreview
			draft={{ status: "ready", sql: "SELECT 1;" }}
			hasExistingSql={false}
			onDraftChange={() => undefined}
			onReplace={() => undefined}
			onAppend={() => undefined}
			onDiscard={() => undefined}
		/>,
	);

	expect(container.querySelector("section")?.className).toContain("rounded-lg");
});

test("renders streamed SQL in a read-only draft editor", () => {
	render(
		<SqlAIPreview
			draft={{
				status: "generating",
				requestId: "request-1",
				sql: "SELECT *",
			}}
			hasExistingSql={false}
			onDraftChange={() => undefined}
			onReplace={() => undefined}
			onAppend={() => undefined}
			onDiscard={() => undefined}
		/>,
	);

	const editor = screen.getByTestId("ai-draft-editor") as HTMLTextAreaElement;
	expect(editor.value).toBe("SELECT *");
	expect(editor.readOnly).toBe(true);
	expect(screen.getByText("Composing query…")).toBeTruthy();
});

test("keeps the empty loading state compact until SQL starts streaming", () => {
	render(
		<SqlAIPreview
			draft={{
				status: "generating",
				requestId: "request-1",
				sql: "",
			}}
			hasExistingSql={false}
			onDraftChange={() => undefined}
			onReplace={() => undefined}
			onAppend={() => undefined}
			onDiscard={() => undefined}
		/>,
	);

	expect(screen.queryByTestId("ai-draft-editor")).toBeNull();
	expect(screen.getByText("Composing query…")).toBeTruthy();
	expect(screen.queryByText("Not executed")).toBeNull();
});

test("allows a completed draft to be edited before it is applied", () => {
	let editedSql = "";
	render(
		<SqlAIPreview
			draft={{ status: "ready", sql: "SELECT * FROM users" }}
			hasExistingSql={true}
			onDraftChange={(sql) => {
				editedSql = sql;
			}}
			onReplace={() => undefined}
			onAppend={() => undefined}
			onDiscard={() => undefined}
		/>,
	);

	const editor = screen.getByTestId("ai-draft-editor") as HTMLTextAreaElement;
	expect(editor.readOnly).toBe(false);
	fireEvent.change(editor, { target: { value: "SELECT id FROM users" } });
	expect(editedSql).toBe("SELECT id FROM users");
	expect(screen.getByText("Append")).toBeTruthy();
	expect(screen.getByText("Use in editor")).toBeTruthy();
});
