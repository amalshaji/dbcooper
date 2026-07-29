import { afterEach, expect, mock, test } from "bun:test";
import { GlobalRegistrator } from "@happy-dom/global-registrator";
import {
	cloneElement,
	isValidElement,
	type ComponentProps,
	type ReactNode,
} from "react";

if (!globalThis.document) GlobalRegistrator.register();

mock.module("@codemirror/lang-sql", () => ({ sql: () => ({}) }));
mock.module("@codemirror/state", () => ({
	EditorState: { readOnly: { of: () => ({}) } },
	Prec: { highest: (value: unknown) => value },
}));

interface EditorUpdate {
	selectionSet: boolean;
	docChanged: boolean;
	state: {
		selection: { main: { from: number; to: number; head: number } };
		doc: { lineAt: (position: number) => { number: number; from: number } };
		sliceDoc: (from: number, to: number) => string;
	};
}

let editorUpdateListener: ((update: EditorUpdate) => void) | undefined;
let editorCreateListener:
	| ((view: { state: EditorUpdate["state"] }) => void)
	| undefined;
mock.module("@codemirror/view", () => ({
	EditorView: {
		lineWrapping: {},
		theme: () => ({}),
		updateListener: {
			of: (listener: (update: EditorUpdate) => void) => {
				editorUpdateListener = listener;
				return {};
			},
		},
	},
	keymap: { of: () => ({}) },
}));
mock.module("@uiw/react-codemirror", () => ({
	default: ({
		value,
		width,
		editable,
		onCreateEditor,
	}: {
		value: string;
		width?: string;
		editable?: boolean;
		onCreateEditor?: (view: { state: EditorUpdate["state"] }) => void;
	}) => (
		<>
			{(() => {
				editorCreateListener = onCreateEditor;
				return null;
			})()}
			<div data-testid="code-mirror" data-width={width} data-editable={editable}>
				{value}
			</div>
		</>
	),
}));
mock.module("thememirror", () => ({ ayuLight: {}, barf: {} }));
mock.module("@/lib/aiDraftState", () => ({
	initialAiDraftState: { status: "idle" },
	aiDraftReducer: (state: unknown) => state,
}));
mock.module("@/components/SqlAIPreview", () => ({
	SqlAIPreview: ({
		draft,
		review,
		onApply,
	}: {
		draft: { status: string; sql?: string; message?: string };
		review: {
			currentSql: string;
			currentVersionLabel: string;
			preservationLabel: string;
			replace: { enabled: boolean; reason?: string };
		};
		onApply?: (mode: "append" | "replace") => void;
	}) => (
		<div data-testid="ai-draft" data-current={review.currentSql}>
			<span>{review.currentVersionLabel}</span>
			<span>{review.preservationLabel}</span>
			{draft.sql ?? draft.message}
			{draft.status === "ready" && onApply ? (
				<>
					<button type="button" onClick={() => onApply("append")}>
						Append
					</button>
					<button
						type="button"
						onClick={() => onApply("replace")}
						disabled={!review.replace.enabled}
						title={review.replace.reason}
					>
						Use in editor
					</button>
				</>
			) : null}
		</div>
	),
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
	TooltipTrigger: ({
		children,
		render,
	}: {
		children: ReactNode;
		render?: ReactNode;
	}) =>
		isValidElement(render) ? (
			cloneElement(render, {}, children)
		) : (
			<>{children}</>
		),
}));

const { act, cleanup, fireEvent, render, screen, waitFor } = await import(
	"@testing-library/react"
);
const { SqlEditor } = await import("./SqlEditor");

afterEach(cleanup);

test("renders streamed SQL in the draft surface owned by the selected query tab", () => {
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
		onApplyDraft: () => {},
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
						scope: { kind: "query", sql: "SELECT * FROM users" },
						sql: "SELECT *",
					},
				},
			}}
		/>,
	);

	expect(
		(
			screen.getByPlaceholderText(
				"Ask for a query or change…",
			) as HTMLInputElement
		).value,
	).toBe("List active users");
	expect(screen.getByTestId("ai-draft").textContent).toContain("SELECT *");
	expect(screen.queryByTestId("code-mirror")).toBeNull();
	expect(screen.queryByRole("button", { name: "Append" })).toBeNull();
	expect(screen.queryByRole("button", { name: "Use in editor" })).toBeNull();

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
						scope: { kind: "query", sql: "SELECT * FROM users" },
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

test("delegates completed draft application to the tab owner", () => {
	let appliedMode = "";
	render(
		<SqlEditor
			value="SELECT id FROM users"
			onChange={() => {}}
			ai={{
				configured: true,
				state: {
					instruction: "Show organizations",
					draft: {
						status: "ready",
						scope: { kind: "query", sql: "SELECT id FROM users" },
						sql: "SELECT id FROM organizations;",
					},
				},
				onInstructionChange: () => {},
				onDraftChange: () => {},
				onGenerate: async () => {},
				onApplyDraft: (mode) => {
					appliedMode = mode;
				},
				onDiscard: () => {},
			}}
		/>,
	);

	fireEvent.click(screen.getByRole("button", { name: "Append" }));
	expect(appliedMode).toBe("append");
});

test("clears a captured selection after the draft review unmounts the editor", async () => {
	let generatedScope: unknown;
	const handlers = {
		configured: true,
		onInstructionChange: () => {},
		onDraftChange: () => {},
		onGenerate: async (scope: unknown) => {
			generatedScope = scope;
		},
		onApplyDraft: () => {},
		onDiscard: () => {},
	};
	const { rerender } = render(
		<SqlEditor
			value="SELECT id FROM users"
			onChange={() => {}}
			ai={{
				...handlers,
				state: {
					instruction: "Improve this",
					draft: { status: "idle" },
				},
			}}
		/>,
	);

	act(() => {
		editorUpdateListener?.({
			selectionSet: true,
			docChanged: false,
			state: {
				selection: { main: { from: 7, to: 9, head: 9 } },
				doc: { lineAt: () => ({ number: 1, from: 0 }) },
				sliceDoc: () => "id",
			},
		});
	});
	expect(screen.getByPlaceholderText("Ask AI to improve selected SQL…")).toBeTruthy();

	rerender(
		<SqlEditor
			value="SELECT id FROM users"
			onChange={() => {}}
			ai={{
				...handlers,
				state: {
					instruction: "Improve this",
					draft: {
						status: "ready",
						scope: {
							kind: "selection",
							sql: "SELECT id FROM users",
							selection: { from: 7, to: 9, text: "id" },
						},
						sql: "id, name",
					},
				},
			}}
		/>,
	);
	rerender(
		<SqlEditor
			value="SELECT id FROM users"
			onChange={() => {}}
			ai={{
				...handlers,
				state: {
					instruction: "Improve this",
					draft: { status: "idle" },
				},
			}}
		/>,
	);
	act(() => {
		editorCreateListener?.({
			state: {
				selection: { main: { from: 0, to: 0, head: 0 } },
				doc: { lineAt: () => ({ number: 1, from: 0 }) },
				sliceDoc: () => "",
			},
		});
	});

	expect(screen.getByPlaceholderText("Ask for a query or change…")).toBeTruthy();
	fireEvent.click(screen.getByRole("button", { name: /Generate draft/ }));
	await waitFor(() =>
		expect(generatedScope).toEqual({
			kind: "query",
			sql: "SELECT id FROM users",
		}),
	);
});

test("sends an explicit selected-SQL scope to AI", async () => {
	let generatedScope: unknown;
	render(
		<SqlEditor
			value="SELECT id, name FROM users"
			onChange={() => {}}
			ai={{
				configured: true,
				state: {
					instruction: "Include the email",
					draft: { status: "idle" },
				},
				onInstructionChange: () => {},
				onDraftChange: () => {},
				onGenerate: async (scope) => {
					generatedScope = scope;
				},
				onApplyDraft: () => {},
				onDiscard: () => {},
			}}
		/>,
	);

	act(() => {
		editorUpdateListener?.({
			selectionSet: true,
			docChanged: false,
			state: {
				selection: { main: { from: 7, to: 15, head: 15 } },
				doc: { lineAt: () => ({ number: 1, from: 0 }) },
				sliceDoc: () => "id, name",
			},
		});
	});

	expect(
		screen.getByPlaceholderText("Ask AI to improve selected SQL…"),
	).toBeTruthy();
	fireEvent.click(screen.getByRole("button", { name: /Improve selection/ }));
	await waitFor(() =>
		expect(generatedScope).toEqual({
			kind: "selection",
			sql: "SELECT id, name FROM users",
			selection: { from: 7, to: 15, text: "id, name" },
		}),
	);
});

test("delegates selection replacement to the tab owner", () => {
	let appliedMode = "";
	render(
		<SqlEditor
			value="-- keep this comment\nSELECT id, name FROM users"
			onChange={() => {}}
			ai={{
				configured: true,
				state: {
					instruction: "Include email",
					draft: {
						status: "ready",
						scope: {
							kind: "selection",
							sql: "SELECT id, name FROM users",
							selection: { from: 7, to: 15, text: "id, name" },
						},
						sql: "id, name, email",
					},
				},
				onInstructionChange: () => {},
				onDraftChange: () => {},
				onGenerate: async () => {},
				onApplyDraft: (mode) => {
					appliedMode = mode;
				},
				onDiscard: () => {},
			}}
		/>,
	);

	fireEvent.click(screen.getByRole("button", { name: "Use in editor" }));
	expect(appliedMode).toBe("replace");
});

test("does not overwrite SQL when the selected target changed during generation", () => {
	let query = "SELECT email FROM users";
	render(
		<SqlEditor
			value={query}
			onChange={(value) => {
				query = value;
			}}
			ai={{
				configured: true,
				state: {
					instruction: "Include email",
					draft: {
						status: "ready",
						scope: {
							kind: "selection",
							sql: "SELECT id, name FROM users",
							selection: { from: 7, to: 15, text: "id, name" },
						},
						sql: "id, name, email",
					},
				},
				onInstructionChange: () => {},
				onDraftChange: () => {},
				onGenerate: async () => {},
				onApplyDraft: () => {},
				onDiscard: () => {},
			}}
		/>,
	);

	expect(screen.getByText("Selection")).toBeTruthy();
	expect(screen.getByText("Selected SQL changed in the editor")).toBeTruthy();
	const useDraft = screen.getByRole("button", { name: "Use in editor" });
	expect((useDraft as HTMLButtonElement).disabled).toBe(true);
	expect(useDraft.getAttribute("title")).toContain("Append or discard");
	fireEvent.click(useDraft);
	expect(query).toBe("SELECT email FROM users");
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
				onApplyDraft: () => {},
				onDiscard: () => {},
			}}
		/>,
	);

	const prompt = screen.getByPlaceholderText("Ask for a query or change…");
	expect(prompt.parentElement?.className).toContain("rounded-lg");
});

test("keeps one editor frame while an AI draft is under review", () => {
	render(
		<SqlEditor
			value="SELECT id FROM users"
			onChange={() => {}}
			onRunQuery={() => {}}
			toolbarActions={<button type="button">Beautify</button>}
			ai={{
				configured: true,
				state: {
					instruction: "Add names",
					draft: {
						status: "ready",
						scope: { kind: "query", sql: "SELECT id FROM users" },
						sql: "SELECT id, name FROM users",
					},
				},
				onInstructionChange: () => {},
				onDraftChange: () => {},
				onGenerate: async () => {},
				onApplyDraft: () => {},
				onDiscard: () => {},
			}}
		/>,
	);

	const editorFrame = screen.getByTestId("sql-editor-frame");
	expect(editorFrame.contains(screen.getByTestId("ai-draft"))).toBe(true);
	expect(
		editorFrame.contains(screen.getByRole("button", { name: "Beautify" })),
	).toBe(true);
	expect(
		editorFrame.contains(screen.getByRole("button", { name: /Run query/ })),
	).toBe(true);
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
	expect(
		(screen.getByRole("button", { name: /Run query/ }) as HTMLButtonElement)
			.disabled,
	).toBe(false);
});

test("keeps supporting query actions beside Run query inside the editor frame", () => {
	render(
		<SqlEditor
			value="SELECT * FROM users"
			onChange={() => {}}
			onRunQuery={() => {}}
			toolbarActions={<button type="button">Beautify</button>}
		/>,
	);

	const editorFrame = screen.getByTestId("code-mirror").parentElement;
	expect(editorFrame?.firstElementChild?.className).toContain("font-sans");
	expect(
		editorFrame?.contains(screen.getByRole("button", { name: "Beautify" })),
	).toBe(true);
});
