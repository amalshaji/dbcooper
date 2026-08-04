import { afterEach, expect, mock, test } from "bun:test";
import { GlobalRegistrator } from "@happy-dom/global-registrator";
import { clsx, type ClassValue } from "clsx";
import type { ComponentProps, ReactNode } from "react";
import { twMerge } from "tailwind-merge";

if (!globalThis.document) GlobalRegistrator.register();

mock.module("@/lib/utils", () => ({
	cn: (...inputs: ClassValue[]) => twMerge(clsx(inputs)),
}));
mock.module("@uiw/react-codemirror", () => ({
	default: ({
		value,
		onChange,
		editable,
		"aria-label": ariaLabel,
	}: {
		value: string;
		onChange: (value: string) => void;
		editable: boolean;
		"aria-label"?: string;
	}) => (
		<textarea
			aria-label={ariaLabel}
			data-testid="ai-draft-editor"
			value={value}
			readOnly={!editable}
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

const { cleanup, fireEvent, render, screen } = await import(
	"@testing-library/react"
);
const { SqlAIPreview } = await import("./SqlAIPreview");

afterEach(cleanup);

const readyDraft = {
	status: "ready" as const,
	scope: { kind: "query" as const, sql: "SELECT id FROM users" },
	sql: "SELECT id, name FROM users",
};

const review = {
	currentSql: "SELECT id FROM users",
	currentVersionLabel: "Current" as const,
	preservationLabel: "Current query is preserved" as const,
	replace: { enabled: true as const },
};

test("shows streamed SQL read-only until generation completes", () => {
	render(
		<SqlAIPreview
			draft={{
				status: "generating",
				requestId: "request-1",
				scope: readyDraft.scope,
				sql: "SELECT id,",
			}}
			review={review}
		/>,
	);

	expect(screen.getByText("Composing query…")).toBeTruthy();
	expect(screen.getByTestId("spinner")).toBeTruthy();
	const editor = screen.getByLabelText("AI draft SQL") as HTMLTextAreaElement;
	expect(editor.value).toBe("SELECT id,");
	expect(editor.readOnly).toBe(true);
	expect(screen.queryByRole("button", { name: "Append" })).toBeNull();
	expect(screen.queryByRole("button", { name: "Use in editor" })).toBeNull();
});

test("reviews a completed AI draft in a single editor by default", () => {
	render(
		<SqlAIPreview
			draft={readyDraft}
			review={review}
			onDraftChange={() => undefined}
			onApply={() => undefined}
			onDiscard={() => undefined}
		/>,
	);

	expect(screen.getByText("Review AI draft")).toBeTruthy();
	expect(screen.getByText("Current query is preserved")).toBeTruthy();
	expect(
		screen.getByRole("button", { name: "AI draft" }).getAttribute("aria-pressed"),
	).toBe("true");
	const editor = screen.getByLabelText("AI draft SQL") as HTMLTextAreaElement;
	expect(editor.value).toBe("SELECT id, name FROM users");
	expect(editor.readOnly).toBe(false);
	expect(screen.queryByTestId("legacy-diff")).toBeNull();
});

test("switches between a read-only current query and an editable draft", () => {
	let editedSql = "";
	render(
		<SqlAIPreview
			draft={readyDraft}
			review={{ ...review, currentSql: "SELECT id, email FROM users" }}
			onDraftChange={(sql) => {
				editedSql = sql;
			}}
			onApply={() => undefined}
			onDiscard={() => undefined}
		/>,
	);

	fireEvent.click(screen.getByRole("button", { name: "Current" }));
	const currentEditor = screen.getByLabelText(
		"Current SQL query",
	) as HTMLTextAreaElement;
	expect(currentEditor.value).toBe("SELECT id, email FROM users");
	expect(currentEditor.readOnly).toBe(true);

	fireEvent.click(screen.getByRole("button", { name: "AI draft" }));
	const draftEditor = screen.getByLabelText("AI draft SQL");
	fireEvent.change(draftEditor, {
		target: { value: "SELECT id, name, email FROM users" },
	});
	expect(editedSql).toBe("SELECT id, name, email FROM users");
});

test("exposes explicit discard, append, and replace actions", () => {
	const actions: string[] = [];
	render(
		<SqlAIPreview
			draft={readyDraft}
			review={review}
			onDraftChange={() => undefined}
			onApply={(mode) => actions.push(mode)}
			onDiscard={() => actions.push("discard")}
		/>,
	);

	fireEvent.click(screen.getByRole("button", { name: "Discard" }));
	fireEvent.click(screen.getByRole("button", { name: "Append" }));
	fireEvent.click(screen.getByRole("button", { name: "Use in editor" }));
	expect(actions).toEqual(["discard", "append", "replace"]);
});

test("uses the existing editor frame instead of nested panel chrome", () => {
	const { container } = render(
		<SqlAIPreview
			embedded
			draft={readyDraft}
			review={review}
			onDraftChange={() => undefined}
			onApply={() => undefined}
			onDiscard={() => undefined}
		/>,
	);

	const reviewPanel = container.querySelector("section");
	expect(reviewPanel?.className).toContain("flex-1");
	expect(reviewPanel?.className).not.toContain("rounded-lg");
});
