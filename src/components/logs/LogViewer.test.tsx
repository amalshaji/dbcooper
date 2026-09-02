import { afterEach, describe, expect, mock, test } from "bun:test";
import { GlobalRegistrator } from "@happy-dom/global-registrator";
import {
	cloneElement,
	createContext,
	isValidElement,
	type ComponentProps,
	type PropsWithChildren,
	type ReactElement,
	useContext,
	useState,
} from "react";

if (!globalThis.document) GlobalRegistrator.register();

const { cleanup, fireEvent, render, screen } = await import(
	"@testing-library/react/pure"
);

const MenuContext = createContext<{
	open: boolean;
	setOpen: (open: boolean) => void;
} | null>(null);
const MenuGroupContext = createContext(false);

function TestDropdownMenu({ children }: PropsWithChildren) {
	const [open, setOpen] = useState(false);
	return (
		<MenuContext.Provider value={{ open, setOpen }}>
			{children}
		</MenuContext.Provider>
	);
}

function TestDropdownMenuTrigger({
	children,
	render,
}: PropsWithChildren<{ render?: ReactElement }>) {
	const menu = useContext(MenuContext);
	if (!menu || !isValidElement<ComponentProps<"button">>(render)) return null;
	return cloneElement(render, { onClick: () => menu.setOpen(true), children });
}

function TestDropdownMenuContent({ children }: PropsWithChildren) {
	return useContext(MenuContext)?.open ? <div>{children}</div> : null;
}

function TestDropdownMenuLabel({ children }: PropsWithChildren) {
	if (!useContext(MenuGroupContext)) {
		throw new Error("Menu group label requires a menu group");
	}
	return <div>{children}</div>;
}

afterEach(() => cleanup());

describe("LogViewer", () => {
	test("opens the level filter without crashing the viewer", async () => {
		const logs = await import("../../lib/logs");
		mock.module("@/lib/logs", () => logs);
		const utils = await import("../../lib/utils");
		mock.module("@/lib/utils", () => utils);
		mock.module("@/components/ui/button", () => ({
			Button: ({
				children,
				variant: _variant,
				size: _size,
				...props
			}: ComponentProps<"button"> & { variant?: string; size?: string }) => (
				<button {...props}>{children}</button>
			),
		}));
		mock.module("@/components/ui/input", () => ({
			Input: (props: ComponentProps<"input">) => <input {...props} />,
		}));
		mock.module("@/components/ui/spinner", () => ({
			Spinner: () => <span>Loading</span>,
		}));
		mock.module("@/components/ui/dropdown-menu", () => ({
			DropdownMenu: TestDropdownMenu,
			DropdownMenuCheckboxItem: ({ children }: PropsWithChildren) => (
				<div>{children}</div>
			),
			DropdownMenuContent: TestDropdownMenuContent,
			DropdownMenuGroup: ({ children }: PropsWithChildren) => (
				<MenuGroupContext.Provider value>{children}</MenuGroupContext.Provider>
			),
			DropdownMenuLabel: TestDropdownMenuLabel,
			DropdownMenuSeparator: () => <hr />,
			DropdownMenuTrigger: TestDropdownMenuTrigger,
		}));
		mock.module("sonner", () => ({
			toast: { error: () => {}, success: () => {} },
		}));

		const { LogViewer } = await import("./LogViewer");
		render(
			<LogViewer
				mode="logs"
				entries={[]}
				status="streaming"
				error={null}
				onClear={() => {}}
				onRetry={() => {}}
			/>,
		);

		fireEvent.click(screen.getByRole("button", { name: /Filter levels/i }));

		expect(screen.getByText("Show levels")).not.toBeNull();
		expect(screen.getByRole("list", { name: "Live database logs" })).not.toBeNull();
	});
});
