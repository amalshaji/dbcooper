import { describe, expect, test } from "bun:test";
import { continueWhileCurrent } from "./latestRequestRegistry";
import { TabRequestController } from "./tabRequestController";

describe("TabRequestController", () => {
	test("only the latest request for a table can commit", () => {
		const controller = new TabRequestController();
		const older = controller.beginTable("users");
		const newer = controller.beginTable("users");
		const commits: string[] = [];

		older.commit(() => commits.push("older"));
		newer.commit(() => commits.push("newer"));

		expect(commits).toEqual(["newer"]);
	});

	test("table work becomes stale when its tab closes or connection resets", () => {
		const controller = new TabRequestController();
		const beforeClose = controller.watchTable("users");

		controller.invalidateTab("users");
		expect(beforeClose.isCurrent()).toBe(false);

		const beforeReset = controller.watchTable("users");
		controller.reset();
		expect(beforeReset.isCurrent()).toBe(false);
	});

	test("table invalidation stops a batch before the next write", async () => {
		const controller = new TabRequestController();
		const table = controller.watchTable("users");
		const completed: number[] = [];

		const finished = await continueWhileCurrent(
			[1, 2],
			() => table.isCurrent(),
			async (item) => {
				completed.push(item);
				controller.invalidateTab("users");
			},
		);

		expect(finished).toBe(false);
		expect(completed).toEqual([1]);
	});

	test("table and query channels stay independent", () => {
		const controller = new TabRequestController();
		const table = controller.beginTable("users");

		controller.beginQuery("users");

		expect(table.isCurrent()).toBe(true);
	});
});
