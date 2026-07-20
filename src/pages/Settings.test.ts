import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";

const settingsSource = readFileSync(
	new URL("./Settings.tsx", import.meta.url),
	"utf8",
);

function classesFor(tag: "div" | "header" | "main") {
	const className = settingsSource.match(
		new RegExp(`<${tag}[\\s\\S]*?className="([^"]+)"`),
	)?.[1];

	expect(className).toBeDefined();
	return className?.split(" ") ?? [];
}

describe("Settings page layout", () => {
	test("keeps the page within the viewport and scrolls only the main content", () => {
		expect(classesFor("div")).toEqual(
			expect.arrayContaining(["h-screen", "overflow-hidden"]),
		);
		expect(classesFor("main")).toEqual(
			expect.arrayContaining(["min-h-0", "flex-1", "overflow-auto"]),
		);
	});

	test("keeps the navigation bar sticky above the scrolling content", () => {
		expect(classesFor("header")).toEqual(
			expect.arrayContaining(["sticky", "top-0", "z-20", "shrink-0"]),
		);
	});
});
