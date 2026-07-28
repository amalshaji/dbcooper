import { afterEach, expect, mock, test } from "bun:test";
import { GlobalRegistrator } from "@happy-dom/global-registrator";

if (!globalThis.document) GlobalRegistrator.register();

let editorTheme: Record<string, unknown> | undefined;

mock.module("@codemirror/lang-json", () => ({ json: () => ({}) }));
mock.module("@codemirror/view", () => ({
	EditorView: {
		lineWrapping: {},
		theme: (theme: Record<string, unknown>) => {
			editorTheme = theme;
			return {};
		},
	},
}));
mock.module("@uiw/react-codemirror", () => ({
	default: ({
		className,
		height,
	}: {
		className?: string;
		height?: string;
	}) => (
		<div
			data-testid="code-mirror"
			className={className}
			data-height={height}
		/>
	),
}));
mock.module("thememirror", () => ({ barf: {}, rosePineDawn: {} }));
mock.module("@/lib/utils", () => ({
	cn: (...values: Array<string | undefined>) => values.filter(Boolean).join(" "),
}));

const { cleanup, render, screen } = await import("@testing-library/react");
const { MongoJsonEditor } = await import("./MongoJsonEditor");

afterEach(cleanup);

test("gives CodeMirror a bounded viewport for wheel scrolling", () => {
	render(
		<MongoJsonEditor
			value={'{\n  "_id": 1\n}'}
			onChange={() => undefined}
			ariaLabel="MongoDB document"
		/>,
	);

	const editor = screen.getByTestId("code-mirror");
	expect(editor.className.split(" ")).toContain("h-full");
	expect(editor.className.split(" ")).toContain("min-h-0");
	expect(editor.dataset.height).toBe("100%");
	expect(editorTheme?.[".cm-scroller"]).toEqual({ overflowY: "auto" });
});
