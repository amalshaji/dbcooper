import { describe, expect, mock, test } from "bun:test";
import type { ComponentProps } from "react";
import { renderToStaticMarkup } from "react-dom/server";

mock.module("@/components/ui/switch", () => ({
	Switch: ({
		onCheckedChange: _onCheckedChange,
		...props
	}: ComponentProps<"input"> & {
		onCheckedChange?: (checked: boolean) => void;
	}) => <input type="checkbox" readOnly {...props} />,
}));

mock.module("@/components/ui/label", () => ({
	Label: (props: ComponentProps<"label">) => <label {...props} />,
}));

const { UpdateChannelSetting } = await import("./UpdateChannelSetting");

describe("UpdateChannelSetting", () => {
	test("renders stable updates as the safe default", () => {
		const markup = renderToStaticMarkup(
			<UpdateChannelSetting enabled={false} onEnabledChange={() => {}} />,
		);

		expect(markup).toContain("Canary updates");
		expect(markup).toContain("Receive stable releases only.");
		expect(markup).not.toContain('checked=""');
	});

	test("warns when canary updates are enabled", () => {
		const markup = renderToStaticMarkup(
			<UpdateChannelSetting enabled onEnabledChange={() => {}} />,
		);

		expect(markup).toContain("Get early builds from every merge.");
		expect(markup).toContain("Canary builds may be unstable.");
		expect(markup).toContain('checked=""');
	});
});
