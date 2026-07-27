import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";

const connectionDetailsSource = readFileSync(
	new URL("./ConnectionDetails.tsx", import.meta.url),
	"utf8",
);

function cardHeaderClassesFor(title: string) {
	const titleIndex = connectionDetailsSource.indexOf(
		`<CardTitle>${title}</CardTitle>`,
	);
	expect(titleIndex).toBeGreaterThan(-1);

	const headerIndex = connectionDetailsSource.lastIndexOf(
		"<CardHeader",
		titleIndex,
	);
	const headerEnd = connectionDetailsSource.indexOf(">", headerIndex);
	const openingTag = connectionDetailsSource.slice(headerIndex, headerEnd + 1);

	return openingTag.match(/className="([^"]+)"/)?.[1].split(" ") ?? [];
}

describe("ConnectionDetails query layout", () => {
	test("lets the cards own the section header top padding", () => {
		for (const title of ["SQL editor", "Query results"]) {
			expect(cardHeaderClassesFor(title)).not.toEqual(
				expect.arrayContaining(["pt-4"]),
			);
			expect(cardHeaderClassesFor(title)).not.toEqual(
				expect.arrayContaining(["py-4"]),
			);
		}
	});
});
