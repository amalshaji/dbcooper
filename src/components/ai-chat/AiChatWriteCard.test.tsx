import { afterEach, expect, mock, test } from "bun:test";
import { GlobalRegistrator } from "@happy-dom/global-registrator";
import type { ComponentProps } from "react";
import type { AiChatWrite } from "@/lib/tauri/aiChat";

if (!globalThis.document) GlobalRegistrator.register();

mock.module("@/components/ui/button", () => ({
	Button: ({ children, ...props }: ComponentProps<"button">) => (
		<button type="button" {...props}>
			{children}
		</button>
	),
}));

const { cleanup, fireEvent, render, screen } = await import(
	"@testing-library/react"
);
const { AiChatWriteCard } = await import("./AiChatWriteCard");

afterEach(cleanup);

function write(overrides: Partial<AiChatWrite> = {}): AiChatWrite {
	return {
		language: "sql",
		query: "CREATE TABLE notes (id INTEGER)",
		display: "CREATE TABLE notes (id INTEGER)",
		summary: "Create a notes table",
		status: "pending",
		rows_affected: null,
		error: null,
		...overrides,
	};
}

test("shows the exact statement and asks for approval while pending", () => {
	const decisions: boolean[] = [];
	render(
		<AiChatWriteCard
			write={write()}
			connectionName="Local Postgres"
			disabled={false}
			onResolve={(approve) => decisions.push(approve)}
		/>,
	);
	expect(screen.getByText("CREATE TABLE notes (id INTEGER)")).toBeTruthy();
	expect(screen.getByText("Proposed change to Local Postgres")).toBeTruthy();

	fireEvent.click(screen.getByText("Approve & run"));
	fireEvent.click(screen.getByText("Reject"));
	expect(decisions).toEqual([true, false]);
});

test("disables decisions while another request runs", () => {
	render(
		<AiChatWriteCard
			write={write()}
			connectionName="db"
			disabled
			onResolve={() => undefined}
		/>,
	);
	expect(
		(screen.getByText("Approve & run") as HTMLButtonElement).disabled,
	).toBe(true);
});

test("reports outcomes without offering approval again", () => {
	const { rerender } = render(
		<AiChatWriteCard
			write={write({ status: "executed", rows_affected: 2 })}
			connectionName="db"
			disabled={false}
			onResolve={() => undefined}
		/>,
	);
	expect(screen.queryByText("Approve & run")).toBeNull();
	expect(screen.getByText(/2 rows affected/)).toBeTruthy();

	rerender(
		<AiChatWriteCard
			write={write({ status: "failed", error: "relation exists" })}
			connectionName="db"
			disabled={false}
			onResolve={() => undefined}
		/>,
	);
	expect(screen.getByText("Failed: relation exists")).toBeTruthy();

	rerender(
		<AiChatWriteCard
			write={write({ status: "rejected" })}
			connectionName="db"
			disabled={false}
			onResolve={() => undefined}
		/>,
	);
	expect(screen.getByText("Not run")).toBeTruthy();

	rerender(
		<AiChatWriteCard
			write={write({ status: "executing" })}
			connectionName="db"
			disabled={false}
			onResolve={() => undefined}
		/>,
	);
	expect(screen.queryByText("Approve & run")).toBeNull();
	expect(screen.getByText(/outcome is unknown/)).toBeTruthy();
});
