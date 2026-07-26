import { afterEach, describe, expect, mock, test } from "bun:test";
import { GlobalRegistrator } from "@happy-dom/global-registrator";
import type { ComponentProps, ReactNode } from "react";
import {
	captureSavedViewState,
	createColumnLayout,
	decodeSavedViewState,
	getSavedViewStatus,
} from "../../lib/savedViews";
import type { SavedView } from "../../lib/tauri";

if (!globalThis.document) GlobalRegistrator.register();

let listHandler = async (
	_connectionUuid: string,
	_tableName: string,
): Promise<SavedView[]> => [];

mock.module("@/components/ui/button", () => ({
	Button: ({ children, ...props }: ComponentProps<"button">) => (
		<button {...props}>{children}</button>
	),
}));
mock.module("@/components/ui/input", () => ({
	Input: (props: ComponentProps<"input">) => <input {...props} />,
}));
mock.module("@/components/ui/spinner", () => ({
	Spinner: () => <span>Loading</span>,
}));
mock.module("@/lib/savedViews", () => ({
	decodeSavedViewState,
	getSavedViewStatus,
}));
mock.module("@/lib/tauri", () => ({
	api: {
		savedViews: {
			list: (connectionUuid: string, tableName: string) =>
				listHandler(connectionUuid, tableName),
			create: async () => null,
			update: async () => null,
			delete: async () => true,
		},
	},
}));
mock.module("sonner", () => ({
	toast: { error: () => {}, success: () => {}, warning: () => {} },
}));

mock.module("@/components/ui/dropdown-menu", () => ({
	DropdownMenu: ({ children }: { children: ReactNode }) => (
		<div>{children}</div>
	),
	DropdownMenuContent: ({ children }: { children: ReactNode }) => (
		<div>{children}</div>
	),
	DropdownMenuItem: ({
		children,
		variant: _variant,
		...props
	}: ComponentProps<"button"> & { variant?: string }) => (
		<button type="button" {...props}>
			{children}
		</button>
	),
	DropdownMenuLabel: ({ children }: { children: ReactNode }) => (
		<div>{children}</div>
	),
	DropdownMenuSeparator: () => <hr />,
	DropdownMenuSub: ({ children }: { children: ReactNode }) => (
		<div>{children}</div>
	),
	DropdownMenuSubContent: ({ children }: { children: ReactNode }) => (
		<div>{children}</div>
	),
	DropdownMenuSubTrigger: ({ children }: { children: ReactNode }) => (
		<div>{children}</div>
	),
	DropdownMenuTrigger: ({ children }: { children: ReactNode }) => (
		<div>{children}</div>
	),
}));

mock.module("@/components/ui/dialog", () => ({
	Dialog: ({ children }: { children: ReactNode }) => <div>{children}</div>,
	DialogContent: ({ children }: { children: ReactNode }) => (
		<div>{children}</div>
	),
	DialogDescription: ({ children }: { children: ReactNode }) => (
		<p>{children}</p>
	),
	DialogFooter: ({ children }: { children: ReactNode }) => (
		<div>{children}</div>
	),
	DialogHeader: ({ children }: { children: ReactNode }) => (
		<div>{children}</div>
	),
	DialogTitle: ({ children }: { children: ReactNode }) => <h2>{children}</h2>,
}));

mock.module("@/components/ui/alert-dialog", () => ({
	AlertDialog: ({ children }: { children: ReactNode }) => <div>{children}</div>,
	AlertDialogAction: ({ children }: { children: ReactNode }) => (
		<button type="button">{children}</button>
	),
	AlertDialogCancel: ({ children }: { children: ReactNode }) => (
		<button type="button">{children}</button>
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

const { SavedViewsMenu } = await import("./SavedViewsMenu");
const { act, cleanup, render, screen, waitFor } = await import(
	"@testing-library/react"
);

afterEach(() => {
	cleanup();
	listHandler = async () => [];
});

const currentState = captureSavedViewState(null, null, {
	...createColumnLayout(["id"]),
	columnWidths: { id: 220 },
});

function view(id: number, tableName: string, name: string): SavedView {
	return {
		id,
		connection_uuid: "connection-1",
		table_name: tableName,
		name,
		state: { status: "current", state: currentState },
		created_at: "2026-07-26 12:00:00",
		updated_at: "2026-07-26 12:00:00",
	};
}

describe("SavedViewsMenu", () => {
	test("shows a compact empty state and the save action", async () => {
		render(
			<SavedViewsMenu
				connectionUuid="connection-1"
				tableName="public.events"
				currentState={currentState}
				activeViewId={1}
				loading={false}
				hasUnappliedFilterDraft={false}
				onActiveViewChange={() => {}}
				onApply={async () => true}
			/>,
		);
		await act(async () => {});

		expect(screen.getByText("Views")).not.toBeNull();
		expect(screen.getByText(/No views saved for this table/)).not.toBeNull();
		expect(screen.getByText(/Save current view/)).not.toBeNull();
	});

	test("does not retain another table's views when the scope changes", async () => {
		listHandler = async (_connectionUuid, tableName) => {
			if (tableName === "public.events") {
				return [view(1, tableName, "Recent events")];
			}
			throw new Error("load failed");
		};
		const props = {
			connectionUuid: "connection-1",
			currentState,
			activeViewId: null,
			loading: false,
			hasUnappliedFilterDraft: false,
			onActiveViewChange: () => {},
			onApply: async () => true,
		};
		const { rerender } = render(
			<SavedViewsMenu {...props} tableName="public.events" />,
		);

		expect(
			(await screen.findAllByText("Recent events")).length,
		).toBeGreaterThan(0);
		rerender(<SavedViewsMenu {...props} tableName="public.audit_log" />);

		await waitFor(() => {
			expect(screen.queryAllByText("Recent events")).toHaveLength(0);
		});
	});
});
