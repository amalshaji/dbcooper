import { afterEach, expect, mock, test } from "bun:test";
import { GlobalRegistrator } from "@happy-dom/global-registrator";
import type { ComponentProps, ReactNode } from "react";
import type { AiChatMessage } from "@/lib/tauri/aiChat";
import * as chartData from "../../lib/aiChat/chartData";

if (!globalThis.document) GlobalRegistrator.register();

mock.module("@/lib/aiChat/chartData", () => chartData);
mock.module("sonner", () => ({ toast: { success: () => undefined } }));
mock.module("@/components/ui/button", () => ({
	Button: ({ children, ...props }: ComponentProps<"button">) => (
		<button type="button" {...props}>
			{children}
		</button>
	),
}));
mock.module("@/components/ui/spinner", () => ({
	Spinner: () => <span data-testid="spinner" />,
}));
mock.module("@/components/ui/table", () => ({
	Table: (props: ComponentProps<"table">) => <table {...props} />,
	TableHeader: (props: ComponentProps<"thead">) => <thead {...props} />,
	TableBody: (props: ComponentProps<"tbody">) => <tbody {...props} />,
	TableRow: (props: ComponentProps<"tr">) => <tr {...props} />,
	TableHead: (props: ComponentProps<"th">) => <th {...props} />,
	TableCell: (props: ComponentProps<"td">) => <td {...props} />,
}));
mock.module("./ResultChart", () => ({
	default: ({ spec }: { spec: { type: string } }) => (
		<div data-testid="chart">{spec.type}</div>
	),
}));
mock.module("@/components/ui/tabs", () => ({
	Tabs: ({
		children,
		onValueChange,
	}: {
		children: ReactNode;
		onValueChange: (value: string) => void;
	}) => (
		<div>
			{children}
			<button type="button" onClick={() => onValueChange("table")}>
				show table
			</button>
		</div>
	),
	TabsList: ({ children }: { children: ReactNode }) => <div>{children}</div>,
	TabsTrigger: ({ children }: ComponentProps<"button">) => (
		<span>{children}</span>
	),
}));

const { cleanup, fireEvent, render, screen } = await import(
	"@testing-library/react"
);
const { AiChatResult } = await import("./AiChatResult");

afterEach(cleanup);

function message(chart: unknown): AiChatMessage {
	return {
		id: 1,
		conversation_id: 1,
		role: "assistant",
		text: "Revenue grew.",
		steps: [
			{
				id: 1,
				kind: "query",
				language: "sql",
				query: "SELECT month, revenue FROM sales",
				purpose: null,
				inspect: "none",
				row_count: 2,
				truncated: false,
				duration_ms: 4,
				error: null,
				running: false,
			},
		],
		result: {
			step: 1,
			rows: [
				{ month: "2026-01", revenue: 10 },
				{ month: "2026-02", revenue: 20 },
			],
			truncated: false,
		},
		chart,
		error: null,
		created_at: "",
	};
}

test("renders a validated chart and switches to the table", async () => {
	render(
		<AiChatResult
			message={message({ type: "bar", x: "month", y: ["revenue"] })}
		/>,
	);
	expect((await screen.findByTestId("chart")).textContent).toBe("bar");

	fireEvent.click(screen.getByText("show table"));
	expect(screen.getByText("2026-02")).toBeTruthy();
});

test("falls back to the table and explains an invalid chart", () => {
	render(
		<AiChatResult
			message={message({ type: "bar", x: "month", y: ["missing"] })}
		/>,
	);
	expect(screen.queryByTestId("chart")).toBeNull();
	expect(screen.getByText("2026-01")).toBeTruthy();
	expect(screen.getByText(/Chart not shown/)).toBeTruthy();
});

test("opens SQL in a query tab", () => {
	const opened: string[] = [];
	render(
		<AiChatResult
			message={message(null)}
			onOpenQuery={(query) => opened.push(query)}
		/>,
	);
	fireEvent.click(screen.getByLabelText("Open in query tab"));
	expect(opened).toEqual(["SELECT month, revenue FROM sales"]);
});
