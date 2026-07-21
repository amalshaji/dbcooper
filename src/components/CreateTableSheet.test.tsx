import { afterEach, describe, expect, mock, test } from "bun:test";
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
mock.module("@/components/ui/sheet", () => ({
	Sheet: ({ children }: { children: ReactNode }) => <div>{children}</div>,
	SheetContent: ({ children }: { children: ReactNode }) => <div>{children}</div>,
	SheetDescription: ({ children }: { children: ReactNode }) => (
		<p>{children}</p>
	),
	SheetFooter: ({ children }: { children: ReactNode }) => <div>{children}</div>,
	SheetHeader: ({ children }: { children: ReactNode }) => <div>{children}</div>,
	SheetTitle: ({ children }: { children: ReactNode }) => <h2>{children}</h2>,
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
	SelectValue: () => null,
}));
mock.module("@/components/ui/switch", () => ({
	Switch: ({
		checked,
		onCheckedChange: _onCheckedChange,
		size: _size,
		...props
	}: ComponentProps<"input"> & {
		onCheckedChange?: (checked: boolean) => void;
		size?: string;
	}) => <input type="checkbox" checked={checked} readOnly {...props} />,
}));
mock.module("@/components/ui/spinner", () => ({
	Spinner: () => <span data-testid="spinner" />,
}));

const { cleanup, fireEvent, render, screen, waitFor } = await import(
	"@testing-library/react"
);
const userEvent = (await import("@testing-library/user-event")).default;
const { CreateTableSheet } = await import("./CreateTableSheet");

afterEach(cleanup);

async function defineTable() {
	const user = userEvent.setup();
	await user.type(screen.getByLabelText("Table name"), "events");
	await user.type(screen.getByLabelText("Column name"), "id");
	await user.click(screen.getByRole("button", { name: "Review SQL" }));
	return user;
}

describe("CreateTableSheet", () => {
	test("previews and executes the reviewed request exactly once", async () => {
		let createCalls = 0;
		let finishCreate: ((table: {
			schema: string;
			name: string;
			type: string;
		}) => void) | undefined;
		const onCreated = mock(() => {});
		const onClose = mock(() => {});

		render(
			<CreateTableSheet
				dbType="sqlite"
				initialSchema="main"
				availableSchemas={["main"]}
				onClose={onClose}
				onPreview={async () =>
					'CREATE TABLE "main"."events" ("id" TEXT);'
				}
				onCreate={() => {
					createCalls += 1;
					return new Promise((resolve) => {
						finishCreate = resolve;
					});
				}}
				onCreated={onCreated}
			/>,
		);

		await defineTable();
		expect(
			(await screen.findByLabelText("Generated SQL")).textContent,
		).toContain("CREATE TABLE");

		const createButton = screen.getByRole("button", {
			name: "Create table",
		});
		fireEvent.click(createButton);
		fireEvent.click(createButton);

		expect(createCalls).toBe(1);
		expect((createButton as HTMLButtonElement).disabled).toBe(true);
		expect(screen.getByTestId("spinner")).not.toBeNull();
		expect(createButton.textContent).toContain("Create table");

		finishCreate?.({ schema: "main", name: "events", type: "table" });
		await waitFor(() => expect(onCreated).toHaveBeenCalledTimes(1));
		expect(onClose).toHaveBeenCalledTimes(1);
	});

	test("keeps the definition intact when creation fails", async () => {
		render(
			<CreateTableSheet
				dbType="sqlite"
				initialSchema="main"
				availableSchemas={["main"]}
				onClose={() => {}}
				onPreview={async () =>
					'CREATE TABLE "main"."events" ("id" TEXT);'
				}
				onCreate={async () => {
					throw new Error("table events already exists");
				}}
				onCreated={() => {}}
			/>,
		);

		const user = await defineTable();
		await screen.findByLabelText("Generated SQL");
		await user.click(screen.getByRole("button", { name: "Create table" }));

		expect((await screen.findByRole("alert")).textContent).toContain(
			"table events already exists",
		);
		await user.click(screen.getByRole("button", { name: "Back" }));

		expect((screen.getByLabelText("Table name") as HTMLInputElement).value).toBe(
			"events",
		);
		expect(
			(screen.getByLabelText("Column name") as HTMLInputElement).value,
		).toBe("id");
	});
});
