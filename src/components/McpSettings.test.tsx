import { afterEach, expect, mock, test } from "bun:test";
import { GlobalRegistrator } from "@happy-dom/global-registrator";
import type { ComponentProps, ReactNode } from "react";

if (!globalThis.document) GlobalRegistrator.register();

mock.module("@/components/ui/button", () => ({
	Button: ({ children, ...props }: ComponentProps<"button">) => (
		<button {...props}>{children}</button>
	),
}));
mock.module("@/components/ui/input", () => ({
	Input: (props: ComponentProps<"input">) => <input {...props} />,
}));
mock.module("@/components/ui/label", () => ({
	Label: (props: ComponentProps<"label">) => <label {...props} />,
}));
mock.module("@/components/ui/spinner", () => ({
	Spinner: () => <span data-testid="spinner" />,
}));
mock.module("@/components/ui/switch", () => ({
	Switch: ({
		onCheckedChange,
		...props
	}: ComponentProps<"input"> & {
		onCheckedChange?: (checked: boolean) => void;
	}) => (
		<input
			type="checkbox"
			onChange={(event) => onCheckedChange?.(event.target.checked)}
			{...props}
		/>
	),
}));
mock.module("@/components/ui/alert-dialog", () => ({
	AlertDialog: ({
		children,
		open,
	}: {
		children: ReactNode;
		open?: boolean;
	}) => (open ? <div>{children}</div> : null),
	AlertDialogAction: ({ children, ...props }: ComponentProps<"button">) => (
		<button {...props}>{children}</button>
	),
	AlertDialogCancel: ({ children, ...props }: ComponentProps<"button">) => (
		<button {...props}>{children}</button>
	),
	AlertDialogContent: ({ children }: { children: ReactNode }) => (
		<div>{children}</div>
	),
	AlertDialogDescription: ({ children }: { children: ReactNode }) => (
		<p>{children}</p>
	),
	AlertDialogFooter: ({ children }: { children: ReactNode }) => (
		<div>{children}</div>
	),
	AlertDialogHeader: ({ children }: { children: ReactNode }) => (
		<div>{children}</div>
	),
	AlertDialogTitle: ({ children }: { children: ReactNode }) => (
		<h2>{children}</h2>
	),
}));
const { cleanup, render, screen, waitFor } = await import(
	"@testing-library/react"
);
const userEvent = (await import("@testing-library/user-event")).default;
const { McpSettings } = await import("./McpSettings");

interface McpStatus {
	enabled: boolean;
	running: boolean;
	port: number | null;
	url: string | null;
	token: string;
}

afterEach(cleanup);

const disabledStatus: McpStatus = {
	enabled: false,
	running: false,
	port: null,
	url: null,
	token: "secret-token",
};

const runningStatus: McpStatus = {
	enabled: true,
	running: true,
	port: 9420,
	url: "http://127.0.0.1:9420/mcp",
	token: "secret-token",
};

test("keeps the server off by default and hides credentials", async () => {
	render(
		<McpSettings
			client={{
				getStatus: async () => disabledStatus,
				setEnabled: async () => disabledStatus,
				regenerateToken: async () => disabledStatus,
			}}
		/>,
	);

	expect(screen.getByText("Loading MCP status…")).not.toBeNull();
	expect(await screen.findByText("Off")).not.toBeNull();
	expect(screen.queryByLabelText("MCP URL")).toBeNull();
	expect(screen.queryByLabelText("Bearer token")).toBeNull();
});

test("enables the server and exposes copyable configuration with a masked token", async () => {
	const setEnabled = mock(async () => runningStatus);
	const copyText = mock(async (_value: string) => {});
	const user = userEvent.setup();

	render(
		<McpSettings
			client={{
				getStatus: async () => disabledStatus,
				setEnabled,
				regenerateToken: async () => runningStatus,
			}}
			copyText={copyText}
		/>,
	);

	await user.click(await screen.findByRole("checkbox", { name: "MCP server" }));
	await waitFor(() =>
		expect(
			screen.getByText(
				(_content, element) => element?.textContent === "Running · Port 9420",
			),
		).not.toBeNull(),
	);

	expect(setEnabled).toHaveBeenCalledWith(true);
	expect((screen.getByLabelText("MCP URL") as HTMLInputElement).value).toBe(
		"http://127.0.0.1:9420/mcp",
	);
	const tokenInput = screen.getByLabelText("Bearer token") as HTMLInputElement;
	expect(tokenInput.type).toBe("password");

	await user.click(screen.getByRole("button", { name: "Show bearer token" }));
	expect(tokenInput.type).toBe("text");
	await user.click(screen.getByRole("button", { name: "Copy MCP URL" }));
	expect(copyText).toHaveBeenCalledWith("http://127.0.0.1:9420/mcp");
});

test("reverts the switch and reports an enable failure", async () => {
	const user = userEvent.setup();
	render(
		<McpSettings
			client={{
				getStatus: async () => disabledStatus,
				setEnabled: async () => {
					throw new Error("Port unavailable");
				},
				regenerateToken: async () => disabledStatus,
			}}
		/>,
	);

	const toggle = await screen.findByRole("checkbox", { name: "MCP server" });
	await user.click(toggle);

	expect((await screen.findByRole("alert")).textContent).toContain(
		"Port unavailable",
	);
	expect((toggle as HTMLInputElement).checked).toBe(false);
});

test("confirms token regeneration and replaces the displayed credential", async () => {
	const regeneratedStatus = { ...runningStatus, token: "new-secret-token" };
	const regenerateToken = mock(async () => regeneratedStatus);
	const user = userEvent.setup();

	render(
		<McpSettings
			client={{
				getStatus: async () => runningStatus,
				setEnabled: async () => runningStatus,
				regenerateToken,
			}}
		/>,
	);

	await user.click(
		await screen.findByRole("button", { name: "Regenerate token" }),
	);
	expect(screen.getByText("Replace the MCP token?")).not.toBeNull();
	await user.click(screen.getByRole("button", { name: "Regenerate now" }));

	await waitFor(() => expect(regenerateToken).toHaveBeenCalledTimes(1));
	expect((screen.getByLabelText("Bearer token") as HTMLInputElement).value).toBe(
		"new-secret-token",
	);
});
