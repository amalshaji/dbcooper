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
	Select: ({
		children,
		value,
		onValueChange,
		required,
	}: {
		children: ReactNode;
		value: string | null;
		onValueChange: (value: string) => void;
		required?: boolean;
	}) => (
		<select
			aria-label="Database"
			value={value ?? ""}
			required={required}
			onChange={(event) => onValueChange(event.target.value)}
		>
			<option value="">Choose a database</option>
			{children}
		</select>
	),
	SelectContent: ({ children }: { children: ReactNode }) => (
		<>{children}</>
	),
	SelectGroup: ({ children }: { children: ReactNode }) => <>{children}</>,
	SelectItem: ({ children, value }: { children: ReactNode; value: string }) => (
		<option value={value}>{children}</option>
	),
	SelectTrigger: () => null,
	SelectValue: () => null,
}));
mock.module("@/components/ui/spinner", () => ({
	Spinner: () => <span data-testid="spinner" />,
}));

const { cleanup, render, screen } = await import("@testing-library/react");
const userEvent = (await import("@testing-library/user-event")).default;
const { D1ConnectionFields } = await import("./D1ConnectionFields");

afterEach(cleanup);

test("selects a loaded D1 database without exposing its UUID field", async () => {
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
			databaseId=""
			onChange={onChange}
			listDatabases={listDatabases}
		/>,
	);

	expect(screen.queryByLabelText("Database ID")).toBeNull();
	expect(screen.queryByPlaceholderText("D1 database UUID")).toBeNull();
	const databaseSelect = screen.getByRole("combobox", {
		name: "Database",
	}) as HTMLSelectElement;
	expect(databaseSelect.required).toBe(true);
	expect(
		screen
			.getByRole("link", { name: "How to get credentials" })
			.getAttribute("href"),
	).toBe("https://dbcooper.amal.sh/#cloudflare-d1-setup");
	expect(listDatabases).toHaveBeenCalledTimes(0);

	await user.click(screen.getByRole("button", { name: "Load databases" }));

	expect(await screen.findByText("production")).not.toBeNull();
	expect(screen.getByText("staging")).not.toBeNull();
	expect(screen.queryByText("db-1")).toBeNull();
	expect(listDatabases).toHaveBeenCalledWith("account-1", "token-1", 1);

	await user.selectOptions(
		databaseSelect,
		"db-2",
	);

	expect(onChange).toHaveBeenCalledWith({ databaseId: "db-2" });
});
