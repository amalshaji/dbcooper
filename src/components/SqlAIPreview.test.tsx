import { afterEach, expect, mock, test } from "bun:test";
import { GlobalRegistrator } from "@happy-dom/global-registrator";
import { clsx, type ClassValue } from "clsx";
import type { ComponentProps, ReactNode } from "react";
import { twMerge } from "tailwind-merge";

if (!globalThis.document) GlobalRegistrator.register();

mock.module("@/lib/utils", () => ({
	cn: (...inputs: ClassValue[]) => twMerge(clsx(inputs)),
}));

interface DiffFile {
	name: string;
	contents: string;
}

mock.module("@pierre/diffs", () => ({
	parseDiffFromFile: (oldFile: DiffFile, newFile: DiffFile) => ({
		oldFile,
		newFile,
		hunks: [{ additionLines: 2, deletionLines: 1 }],
	}),
}));
mock.module("@pierre/diffs/react", () => ({
	FileDiff: ({
		fileDiff,
	}: {
		fileDiff: { oldFile: DiffFile; newFile: DiffFile };
	}) => (
		<div
			data-testid="ai-sql-diff"
			data-old={fileDiff.oldFile.contents}
			data-new={fileDiff.newFile.contents}
		/>
	),
}));
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

test("streams an existing query into one unified diff", () => {
	render(
		<SqlAIPreview
			draft={{
				status: "generating",
				requestId: "request-1",
				originalSql: "SELECT id FROM users",
				sql: "SELECT id, name FROM users",
			}}
			onDraftChange={() => undefined}
			onReplace={() => undefined}
			onDiscard={() => undefined}
		/>,
	);

	const diff = screen.getByTestId("ai-sql-diff");
	expect(diff.dataset.old).toBe("SELECT id FROM users");
	expect(diff.dataset.new).toBe("SELECT id, name FROM users");
	expect(screen.queryByTestId("ai-draft-editor")).toBeNull();
	expect(screen.getByText("Composing query…")).toBeTruthy();
});

test("uses the standard app border radius", () => {
	const { container } = render(
		<SqlAIPreview
			draft={{ status: "ready", originalSql: "", sql: "SELECT 1;" }}
			onDraftChange={() => undefined}
			onReplace={() => undefined}
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
				originalSql: "",
				sql: "SELECT *",
			}}
			onDraftChange={() => undefined}
			onReplace={() => undefined}
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
				originalSql: "",
				sql: "",
			}}
			onDraftChange={() => undefined}
			onReplace={() => undefined}
			onDiscard={() => undefined}
		/>,
	);

	expect(screen.queryByTestId("ai-draft-editor")).toBeNull();
	expect(screen.getByText("Composing query…")).toBeTruthy();
	expect(screen.queryByText("Not executed")).toBeNull();
});

test("accepts a completed diff without exposing a duplicate editor", () => {
	let accepted = false;
	render(
		<SqlAIPreview
			draft={{
				status: "ready",
				originalSql: "SELECT id FROM users",
				sql: "SELECT id, name FROM users",
			}}
			onDraftChange={() => undefined}
			onReplace={() => {
				accepted = true;
			}}
			onDiscard={() => undefined}
		/>,
	);

	fireEvent.click(screen.getByRole("button", { name: "Accept changes" }));
	expect(accepted).toBe(true);
	expect(screen.queryByTestId("ai-draft-editor")).toBeNull();
	expect(screen.queryByText("Append")).toBeNull();
});

test("allows a completed new-query draft to be edited before it is applied", () => {
	let editedSql = "";
	render(
		<SqlAIPreview
			draft={{
				status: "ready",
				originalSql: "",
				sql: "SELECT * FROM users",
			}}
			onDraftChange={(sql) => {
				editedSql = sql;
			}}
			onReplace={() => undefined}
			onDiscard={() => undefined}
		/>,
	);

	const editor = screen.getByTestId("ai-draft-editor") as HTMLTextAreaElement;
	expect(editor.readOnly).toBe(false);
	fireEvent.change(editor, { target: { value: "SELECT id FROM users" } });
	expect(editedSql).toBe("SELECT id FROM users");
	expect(screen.getByText("Use in editor")).toBeTruthy();
});
