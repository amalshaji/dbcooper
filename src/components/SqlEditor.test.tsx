import { afterEach, expect, mock, test } from "bun:test";
import { GlobalRegistrator } from "@happy-dom/global-registrator";
import type { ComponentProps, ReactNode } from "react";

if (!globalThis.document) GlobalRegistrator.register();

mock.module("@codemirror/lang-sql", () => ({ sql: () => ({}) }));
mock.module("@codemirror/state", () => ({
	EditorState: { readOnly: { of: () => ({}) } },
	Prec: { highest: (value: unknown) => value },
}));
mock.module("@codemirror/view", () => ({
	EditorView: {
		lineWrapping: {},
		theme: () => ({}),
		updateListener: { of: () => ({}) },
	},
	keymap: { of: () => ({}) },
}));
mock.module("@uiw/react-codemirror", () => ({
	default: ({ value, width }: { value: string; width?: string }) => (
		<div data-testid="code-mirror" data-width={width}>
			{value}
		</div>
	),
}));
mock.module("thememirror", () => ({ barf: {}, rosePineDawn: {} }));
mock.module("@/lib/aiDraftState", () => ({
	initialAiDraftState: { status: "idle" },
	aiDraftReducer: (state: unknown) => state,
}));
mock.module("@/components/SqlAIPreview", () => ({
	SqlAIPreview: ({
		draft,
	}: {
		draft: { status: string; sql?: string; message?: string };
	}) => <div data-testid="ai-draft">{draft.sql ?? draft.message}</div>,
}));
mock.module("@/components/ui/button", () => ({
	Button: ({ children, ...props }: ComponentProps<"button">) => (
		<button {...props}>{children}</button>
	),
}));

const DropdownPassThrough = ({
	children,
	render,
}: {
	children?: ReactNode;
	render?: ReactNode;
}) => <>{render ?? children}</>;

mock.module("@/components/ui/dropdown-menu", () => ({
	DropdownMenu: DropdownPassThrough,
	DropdownMenuPortal: DropdownPassThrough,
	DropdownMenuTrigger: DropdownPassThrough,
	DropdownMenuContent: DropdownPassThrough,
	DropdownMenuGroup: DropdownPassThrough,
	DropdownMenuLabel: DropdownPassThrough,
	DropdownMenuItem: DropdownPassThrough,
	DropdownMenuCheckboxItem: DropdownPassThrough,
	DropdownMenuRadioGroup: DropdownPassThrough,
	DropdownMenuRadioItem: DropdownPassThrough,
	DropdownMenuSeparator: () => null,
	DropdownMenuShortcut: DropdownPassThrough,
	DropdownMenuSub: DropdownPassThrough,
	DropdownMenuSubTrigger: DropdownPassThrough,
	DropdownMenuSubContent: DropdownPassThrough,
}));
mock.module("@/components/ui/input", () => ({
	Input: (props: ComponentProps<"input">) => <input {...props} />,
}));
mock.module("@/components/ui/spinner", () => ({ Spinner: () => <span /> }));
mock.module("@/components/ui/tooltip", () => ({
	Tooltip: ({ children }: { children: ReactNode }) => <>{children}</>,
	TooltipContent: ({ children }: { children: ReactNode }) => <>{children}</>,
	TooltipTrigger: ({ children }: { children: ReactNode }) => <>{children}</>,
}));

const { cleanup, render, screen, waitFor } = await import(
	"@testing-library/react"
);
const { SqlEditor } = await import("./SqlEditor");

afterEach(cleanup);

test("renders the AI prompt and draft owned by the selected query tab", () => {
	const commonProps = {
		value: "SELECT * FROM users",
		onChange: () => {},
		tables: [{ schema: "public", name: "users" }],
	};
	const aiHandlers = {
		configured: true,
		onInstructionChange: () => {},
		onDraftChange: () => {},
		onGenerate: async () => {},
		onDiscard: () => {},
	};
	const { rerender } = render(
		<SqlEditor
			{...commonProps}
			ai={{
				...aiHandlers,
				state: {
					instruction: "List active users",
					draft: {
						status: "generating",
						requestId: "request-1",
						originalSql: "SELECT * FROM users",
						sql: "SELECT *",
					},
				},
			}}
		/>,
	);

	expect(
		(screen.getByPlaceholderText("Ask for a query or change…") as HTMLInputElement)
			.value,
	).toBe("List active users");
	expect(screen.getByTestId("ai-draft").textContent).toBe("SELECT *");

	rerender(
		<SqlEditor
			{...commonProps}
			ai={{
				...aiHandlers,
				state: { instruction: "", draft: { status: "idle" } },
			}}
		/>,
	);
	expect(screen.queryByTestId("ai-draft")).toBeNull();

	rerender(
		<SqlEditor
			{...commonProps}
			ai={{
				...aiHandlers,
				state: {
					instruction: "List active users",
					draft: {
						status: "ready",
						originalSql: "SELECT * FROM users",
						sql: "SELECT * FROM users WHERE active = true",
					},
				},
			}}
		/>,
	);
	expect(screen.getByTestId("ai-draft").textContent).toContain(
		"WHERE active = true",
	);
});

test("offers AI generation for an empty database", () => {
	render(
		<SqlEditor
			value=""
			onChange={() => {}}
			tables={[]}
			ai={{
				configured: true,
				state: { instruction: "", draft: { status: "idle" } },
				onInstructionChange: () => {},
				onDraftChange: () => {},
				onGenerate: async () => {},
				onDiscard: () => {},
			}}
		/>,
	);

	const prompt = screen.getByPlaceholderText("Ask for a query or change…");
	expect(prompt.parentElement?.className).toContain("rounded-lg");
});

test("replaces the editable query surface while an AI draft is under review", () => {
	render(
		<SqlEditor
			value="SELECT id FROM users"
			onChange={() => {}}
			ai={{
				configured: true,
				state: {
					instruction: "Add names",
					draft: {
						status: "ready",
						originalSql: "SELECT id FROM users",
						sql: "SELECT id, name FROM users",
					},
				},
				onInstructionChange: () => {},
				onDraftChange: () => {},
				onGenerate: async () => {},
				onDiscard: () => {},
			}}
		/>,
	);

	expect(screen.getByTestId("ai-draft")).toBeTruthy();
	expect(screen.queryByTestId("code-mirror")).toBeNull();
});

test("keeps CodeMirror within the editor content box without an outer scroll layer", async () => {
	const offsetWidth = Object.getOwnPropertyDescriptor(
		HTMLElement.prototype,
		"offsetWidth",
	);
	Object.defineProperty(HTMLElement.prototype, "offsetWidth", {
		configurable: true,
		get: () => 640,
	});

	try {
		render(<SqlEditor value="" onChange={() => {}} />);

		const editor = screen.getByTestId("code-mirror");
		await waitFor(() => expect(editor.dataset.width).toBe("100%"));
		expect(editor.parentElement?.className).not.toContain("overflow-x-auto");
	} finally {
		if (offsetWidth) {
			Object.defineProperty(HTMLElement.prototype, "offsetWidth", offsetWidth);
		} else {
			Reflect.deleteProperty(HTMLElement.prototype, "offsetWidth");
		}
	}
});

test("keeps the Run query control inside the editor frame", () => {
	const onRunQuery = () => {};
	const { rerender } = render(
		<SqlEditor value="" onChange={() => {}} onRunQuery={onRunQuery} />,
	);

	const editorFrame = screen.getByTestId("code-mirror").parentElement;
	const runQuery = screen.getByRole("button", { name: /Run query/ });
	expect(editorFrame?.contains(runQuery)).toBe(true);
	expect((runQuery as HTMLButtonElement).disabled).toBe(true);

	rerender(
		<SqlEditor
			value="SELECT * FROM users"
			onChange={() => {}}
			onRunQuery={onRunQuery}
		/>,
	);
	expect((screen.getByRole("button", { name: /Run query/ }) as HTMLButtonElement).disabled).toBe(false);
});
