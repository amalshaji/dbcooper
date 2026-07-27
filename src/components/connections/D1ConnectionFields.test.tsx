import { afterEach, expect, mock, test } from "bun:test";
import { GlobalRegistrator } from "@happy-dom/global-registrator";
import type { ComponentProps, ReactNode } from "react";

if (!globalThis.document) GlobalRegistrator.register();

mock.module("@/components/ui/button", () => ({
	Button: ({ children, ...props }: ComponentProps<"button">) => (
		<button {...props}>{children}</button>
	),
}));
mock.module("@/components/ui/field", () => ({
	Field: ({ children }: { children: ReactNode }) => <div>{children}</div>,
	FieldLabel: (props: ComponentProps<"label">) => <label {...props} />,
}));
mock.module("@/components/ui/input", () => ({
	Input: (props: ComponentProps<"input">) => <input {...props} />,
}));
mock.module("@/components/ui/select", () => ({
	Select: ({ children }: { children: ReactNode }) => <div>{children}</div>,
	SelectContent: ({ children }: { children: ReactNode }) => (
		<div>{children}</div>
	),
	SelectGroup: ({ children }: { children: ReactNode }) => <div>{children}</div>,
	SelectItem: ({ children }: { children: ReactNode }) => <div>{children}</div>,
	SelectTrigger: ({ children }: { children: ReactNode }) => (
		<button type="button">{children}</button>
	),
}));
mock.module("@/components/ui/spinner", () => ({
	Spinner: () => <span data-testid="spinner" />,
}));

const { cleanup, render, screen } = await import("@testing-library/react");
const userEvent = (await import("@testing-library/user-event")).default;
const { D1ConnectionFields } = await import("./D1ConnectionFields");

afterEach(cleanup);

test("loads D1 databases explicitly while preserving manual database ID entry", async () => {
	const listDatabases = mock(async () => ({
		databases: [
			{ uuid: "db-1", name: "production", created_at: null },
			{ uuid: "db-2", name: "staging", created_at: null },
		],
		page: 1,
		total_pages: 1,
	}));
	const onChange = mock(() => {});
	const user = userEvent.setup();

	render(
		<D1ConnectionFields
			accountId="account-1"
			apiToken="token-1"
			databaseId="manual-id"
			onChange={onChange}
			listDatabases={listDatabases}
		/>,
	);

	expect(screen.getByLabelText("Database ID")).not.toBeNull();
	expect(listDatabases).toHaveBeenCalledTimes(0);

	await user.click(screen.getByRole("button", { name: "Load databases" }));

	expect(await screen.findByText("production")).not.toBeNull();
	expect(screen.getByText("staging")).not.toBeNull();
	expect(listDatabases).toHaveBeenCalledWith("account-1", "token-1", 1);
});
