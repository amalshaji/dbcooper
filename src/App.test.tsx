import { afterEach, beforeEach, expect, mock, test } from "bun:test";
import { GlobalRegistrator } from "@happy-dom/global-registrator";
import type { ReactNode } from "react";

if (!globalThis.document) GlobalRegistrator.register();

mock.module("@/components/ui/sonner", () => ({
	Toaster: () => null,
}));
mock.module("@/components/ui/spinner", () => ({
	Spinner: () => <span role="status" aria-label="Loading route" />,
}));
mock.module("@/contexts/SettingsContext", () => ({
	SettingsProvider: ({ children }: { children: ReactNode }) => children,
}));
mock.module("@/contexts/ThemeContext", () => ({
	ThemeProvider: ({ children }: { children: ReactNode }) => children,
}));
mock.module("@/pages/Connections", () => ({
	Connections: () => <h1>Connections</h1>,
}));

const { cleanup, render, screen } = await import("@testing-library/react");
const { App } = await import("./App");

beforeEach(() => {
	window.location.href = "http://localhost/";
});

afterEach(() => {
	cleanup();
});

test("renders the root route without a suspense loading state", () => {
	render(<App />);

	expect(screen.getByRole("heading", { name: "Connections" })).not.toBeNull();
	expect(screen.queryByRole("status", { name: "Loading route" })).toBeNull();
});
