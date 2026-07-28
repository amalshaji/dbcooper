import { expect, mock, test } from "bun:test";
import type { ComponentProps, ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";

mock.module("@/components/connection-details/MongoJsonEditor", () => ({
	MongoJsonEditor: () => <div data-mongo-json-editor />,
}));
mock.module("@/components/ui/alert-dialog", () => ({
	AlertDialog: ({ children }: { children: ReactNode }) => <>{children}</>,
	AlertDialogAction: (props: ComponentProps<"button">) => <button {...props} />,
	AlertDialogCancel: (props: ComponentProps<"button">) => <button {...props} />,
	AlertDialogContent: ({ children }: { children: ReactNode }) => (
		<>{children}</>
	),
	AlertDialogDescription: ({ children }: { children: ReactNode }) => (
		<p>{children}</p>
	),
	AlertDialogFooter: ({ children }: { children: ReactNode }) => <>{children}</>,
	AlertDialogHeader: ({ children }: { children: ReactNode }) => <>{children}</>,
	AlertDialogTitle: ({ children }: { children: ReactNode }) => (
		<h2>{children}</h2>
	),
}));
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
mock.module("@/components/ui/select", () => ({
	Select: ({ children }: { children: ReactNode }) => <div>{children}</div>,
	SelectContent: ({ children }: { children: ReactNode }) => (
		<div>{children}</div>
	),
	SelectItem: ({ children }: { children: ReactNode }) => <div>{children}</div>,
	SelectTrigger: ({ children }: { children: ReactNode }) => (
		<button data-slot="select-trigger">{children}</button>
	),
	SelectValue: () => <span />,
}));
mock.module("@/components/ui/spinner", () => ({
	Spinner: () => <span>Loading</span>,
}));
mock.module("@/components/ui/switch", () => ({
	Switch: ({ size }: { size?: string }) => <span data-size={size} />,
}));
mock.module("@/lib/tauri", () => ({
	api: { mongo: {} },
}));

const { MongoAiAssistant } = await import("./MongoAiAssistant");
const { MongoCollectionAdmin } = await import("./MongoCollectionAdmin");

test("uses shared compact controls for MongoDB index administration", () => {
	const markup = renderToStaticMarkup(
		<MongoCollectionAdmin
			uuid="connection-1"
			database="app"
			collection="users"
			view="indexes"
		/>,
	);

	expect(markup).toContain('data-slot="select-trigger"');
	expect(markup).not.toContain("<select");
	expect(markup.match(/data-size="sm"/g) ?? []).toHaveLength(2);
});

test("labels generated MongoDB queries as drafts that are not executed", () => {
	const markup = renderToStaticMarkup(
		<MongoAiAssistant
			state={{
				instruction: "Find active users",
				draft: {
					status: "ready",
					sql: '{"version":1,"type":"find"}',
				},
			}}
			configured
			available
			context="Using app.users"
			onInstructionChange={() => undefined}
			onGenerate={() => undefined}
			onUse={() => undefined}
			onDiscard={() => undefined}
		/>,
	);

	expect(markup).toContain("AI query draft");
	expect(markup).toContain("Not executed");
	expect(markup).toContain("Use query");
});
