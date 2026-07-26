import { describe, expect, mock, test } from "bun:test";
import type { ComponentProps, ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import {
	captureSavedViewState,
	createColumnLayout,
	getSavedViewStatus,
} from "../../lib/savedViews";

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
mock.module("@/lib/savedViews", () => ({ getSavedViewStatus }));
mock.module("@/lib/tauri", () => ({
	api: {
		savedViews: {
			list: async () => [],
			create: async () => null,
			update: async () => null,
			delete: async () => true,
		},
	},
}));
mock.module("sonner", () => ({
	toast: { error: () => {}, success: () => {} },
}));

mock.module("@/components/ui/dropdown-menu", () => ({
	DropdownMenu: ({ children }: { children: ReactNode }) => (
		<div>{children}</div>
	),
	DropdownMenuContent: ({ children }: { children: ReactNode }) => (
		<div>{children}</div>
	),
	DropdownMenuItem: ({ children }: { children: ReactNode }) => (
		<button type="button">{children}</button>
	),
	DropdownMenuLabel: ({ children }: { children: ReactNode }) => (
		<div>{children}</div>
	),
	DropdownMenuSeparator: () => <hr />,
	DropdownMenuSub: ({ children }: { children: ReactNode }) => <div>{children}</div>,
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

describe("SavedViewsMenu", () => {
	test("shows a compact empty state and the save action", () => {
		const currentState = captureSavedViewState(null, null, {
			...createColumnLayout(["id"]),
			columnWidths: { id: 220 },
		});
		const html = renderToStaticMarkup(
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

		expect(html).toContain("Views");
		expect(html).toContain("No views saved for this table");
		expect(html).toContain("Save current view");
	});
});
