import { describe, expect, mock, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";

mock.module("@/lib/utils", () => ({
	cn: (...classes: Array<string | undefined>) => classes.filter(Boolean).join(" "),
}));

const { Button } = await import("./button");
const { Sheet, SheetTrigger } = await import("./sheet");

describe("SheetTrigger", () => {
	test("merges trigger attributes into the design-system button", () => {
		const markup = renderToStaticMarkup(
			<Sheet open={false}>
				<SheetTrigger render={<Button />} aria-expanded={false}>
					Open
				</SheetTrigger>
			</Sheet>,
		);

		expect(markup.match(/<button/g)).toHaveLength(1);
		expect(markup).toContain('data-slot="sheet-trigger"');
		expect(markup).toContain("group/button");
		expect(markup).toContain('aria-expanded="false"');
	});
});
