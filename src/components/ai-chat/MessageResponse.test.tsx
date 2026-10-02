import { afterEach, expect, mock, test } from "bun:test";
import { GlobalRegistrator } from "@happy-dom/global-registrator";

if (!globalThis.document) GlobalRegistrator.register();

mock.module("streamdown/styles.css", () => ({}));
mock.module("@/lib/utils", () => ({
	cn: (...classes: unknown[]) => classes.filter(Boolean).join(" "),
}));

const { cleanup, render } = await import("@testing-library/react");
const { MessageResponse } = await import("./MessageResponse");

afterEach(cleanup);

test("renders markdown but neutralises links, images, and raw HTML", () => {
	const { container } = render(
		<MessageResponse>
			{
				"**Revenue** grew in `2026-02`.\n\n- [click me](https://evil.example/?d=1)\n- ![x](https://evil.example/leak.png)\n\n<img src=\"https://evil.example/raw.png\"><a href=\"https://evil.example/x\">raw link</a><script>alert(1)</script>"
			}
		</MessageResponse>,
	);

	expect(
		container.querySelector('[data-streamdown="strong"]')?.textContent,
	).toBe("Revenue");
	expect(container.textContent).toContain("2026-02");
	expect(container.querySelectorAll("li")).toHaveLength(2);
	expect(container.textContent).toContain("click me");
	expect(container.querySelector("a")).toBeNull();
	expect(container.querySelector('[data-streamdown="link"]')).toBeNull();
	expect(container.querySelector("img")).toBeNull();
	expect(container.querySelector("script")).toBeNull();
	expect(container.querySelectorAll("[href], [src]")).toHaveLength(0);
	expect(container.textContent).toContain("<a href=");
});
