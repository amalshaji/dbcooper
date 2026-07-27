import { afterEach, describe, expect, mock, test } from "bun:test";
import { GlobalRegistrator } from "@happy-dom/global-registrator";
import type { ComponentProps } from "react";

if (!globalThis.document) GlobalRegistrator.register();

mock.module("@/components/ui/input", () => ({
	Input: (props: ComponentProps<"input">) => <input {...props} />,
}));
mock.module("@/components/ui/label", () => ({
	Label: (props: ComponentProps<"label">) => <label {...props} />,
}));
mock.module("@/components/ui/switch", () => ({
	Switch: (props: ComponentProps<"input">) => (
		<input type="checkbox" {...props} />
	),
}));

const { cleanup, render } = await import("@testing-library/react");
const { CreateTableMysqlModifiers } = await import(
	"./CreateTableMysqlModifiers"
);

afterEach(cleanup);

describe("CreateTableMysqlModifiers", () => {
	test("does not render an empty modifier row for types without modifiers", () => {
		const { container } = render(
			<CreateTableMysqlModifiers
				columnId="description"
				dbType="mariadb"
				dataType="TEXT"
				modifiers={{
					length: "",
					precision: "",
					scale: "",
					unsigned: false,
					autoIncrement: false,
				}}
				onChange={() => {}}
				onAutoIncrementChange={() => {}}
			/>,
		);

		expect(container.firstElementChild).toBeNull();
	});
});
