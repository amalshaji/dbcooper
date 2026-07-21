import { describe, expect, mock, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";

const utils = await import("../../lib/utils");
mock.module("@/lib/utils", () => utils);

const button = await import("../ui/button");
mock.module("@/components/ui/button", () => button);

const { Sheet } = await import("../ui/sheet");
const { SchemaFilterTrigger } = await import("./SchemaFilterTrigger");

describe("SchemaFilterTrigger", () => {
	test("renders one design-system button with Base UI trigger state", () => {
		const markup = renderToStaticMarkup(
			<Sheet open={false}>
				<SchemaFilterTrigger selectedCount={3} totalCount={8} />
			</Sheet>,
		);

		expect(markup.match(/<button/g)).toHaveLength(1);
		expect(markup).toContain('data-slot="sheet-trigger"');
		expect(markup).toContain('data-base-ui-click-trigger=""');
		expect(markup).toContain("group/button");
		expect(markup).toContain("Filter (3/8)");
	});
});
