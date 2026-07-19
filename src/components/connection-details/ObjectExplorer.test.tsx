import { afterEach, describe, expect, mock, test } from "bun:test";
import { GlobalRegistrator } from "@happy-dom/global-registrator";
import type { ComponentProps, ReactNode } from "react";

if (!globalThis.document) GlobalRegistrator.register();

const Passthrough = ({ children }: { children?: ReactNode }) => (
	<div>{children}</div>
);

mock.module("@/components/ui/badge", () => ({ Badge: Passthrough }));
mock.module("@/components/ui/button", () => ({
	Button: ({ children, ...props }: ComponentProps<"button">) => (
		<button {...props}>{children}</button>
	),
}));
mock.module("@/components/ui/collapsible", () => ({
	Collapsible: Passthrough,
	CollapsibleContent: Passthrough,
	CollapsibleTrigger: Passthrough,
}));
mock.module("@/components/ui/context-menu", () => ({
	ContextMenu: Passthrough,
	ContextMenuContent: Passthrough,
	ContextMenuItem: Passthrough,
	ContextMenuTrigger: Passthrough,
}));
mock.module("@/components/ui/dropdown-menu", () => ({
	DropdownMenu: Passthrough,
	DropdownMenuContent: Passthrough,
	DropdownMenuItem: Passthrough,
	DropdownMenuTrigger: Passthrough,
}));
mock.module("@/components/ui/input", () => ({
	Input: (props: ComponentProps<"input">) => <input {...props} />,
}));
mock.module("@/components/ui/label", () => ({
	Label: (props: ComponentProps<"label">) => <label {...props} />,
}));
mock.module("@/components/ui/sheet", () => ({
	Sheet: Passthrough,
	SheetContent: Passthrough,
	SheetDescription: Passthrough,
	SheetFooter: Passthrough,
	SheetHeader: Passthrough,
	SheetTitle: Passthrough,
}));
mock.module("@/components/ui/select", () => ({
	Select: Passthrough,
	SelectContent: Passthrough,
	SelectGroup: Passthrough,
	SelectItem: Passthrough,
	SelectTrigger: Passthrough,
	SelectValue: Passthrough,
}));
mock.module("@/components/ui/sidebar", () => ({
	SidebarGroup: Passthrough,
	SidebarGroupContent: Passthrough,
	SidebarGroupLabel: Passthrough,
	SidebarMenu: Passthrough,
	SidebarMenuButton: Passthrough,
	SidebarMenuItem: Passthrough,
	SidebarMenuSub: Passthrough,
	SidebarMenuSubButton: Passthrough,
	SidebarMenuSubItem: Passthrough,
}));
mock.module("@/components/ui/spinner", () => ({
	Spinner: () => <span data-testid="spinner" />,
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
mock.module("@/lib/databaseCatalog", () => ({
	getDefaultSchema: (dbType: "postgres" | "sqlite") =>
		dbType === "sqlite" ? "main" : "public",
}));
mock.module("@/types/tabTypes", () => ({
	formatFunctionSignature: () => "",
}));

const { ObjectExplorer } = await import("./ObjectExplorer");
const { cleanup, render, screen } = await import("@testing-library/react");
const userEvent = (await import("@testing-library/user-event")).default;

afterEach(cleanup);

const requiredProps = {
	schemaOverview: null,
	loading: false,
	expandedTables: new Set<string>(),
	tableColumns: {},
	onToggleTableExpand: () => {},
	onOpenTableData: () => {},
	onRunQueryForTable: () => {},
	onOpenTableStructure: () => {},
	onOpenFunctionDefinition: () => {},
	activeQueryTab: null,
	onInsertQueryText: () => {},
};

describe("ObjectExplorer create table capability", () => {
	test("opens the designer for a supported empty database", async () => {
		render(
			<ObjectExplorer
				{...requiredProps}
				createTable={{
					dbType: "sqlite",
					onPreview: async () => "",
					onCreate: async () => ({
						schema: "main",
						name: "events",
						type: "table",
					}),
					onCreated: () => {},
				}}
			/>,
		);

		expect(screen.getByText("No objects found.")).not.toBeNull();
		await userEvent
			.setup()
			.click(screen.getByRole("button", { name: "Create table" }));

		expect((screen.getByLabelText("Schema") as HTMLInputElement).value).toBe(
			"main",
		);
	});

	test("hides the action when the engine has no create-table capability", () => {
		render(<ObjectExplorer {...requiredProps} />);

		expect(
			screen.queryByRole("button", { name: "Create table" }),
		).toBeNull();
	});
});
