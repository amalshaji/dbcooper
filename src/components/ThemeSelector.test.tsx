import { describe, expect, mock, test } from "bun:test";
import type { ComponentProps } from "react";
import { renderToStaticMarkup } from "react-dom/server";

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

const { ThemeSelector } = await import("./ThemeSelector");

describe("ThemeSelector", () => {
	test("renders a distinct and accessible selected theme", () => {
		const markup = renderToStaticMarkup(
			<ThemeSelector theme="dark" onThemeChange={() => {}} />,
		);

		expect(markup).toContain("<legend");
		expect(markup).toContain("Theme</legend>");
		expect(markup).toMatch(
			/<button[^>]*class="[^"]*bg-background[^"]*shadow-sm[^"]*"[^>]*aria-pressed="true"[^>]*>dark<\/button>/,
		);
		expect(markup).toMatch(
			/<button[^>]*class="[^"]*text-muted-foreground[^"]*"[^>]*aria-pressed="false"[^>]*>light<\/button>/,
		);
	});
});
