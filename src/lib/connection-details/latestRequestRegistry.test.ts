import { describe, expect, test } from "bun:test";
import {
	commitIfLatest,
	continueWhileCurrent,
	LatestRequestRegistry,
} from "./latestRequestRegistry";

describe("LatestRequestRegistry", () => {
	test("ignores an older response after a newer request starts", () => {
		const registry = new LatestRequestRegistry();
		const older = registry.issue("table:users");
		const newer = registry.issue("table:users");
		const commits: string[] = [];

		commitIfLatest(registry, older, () => commits.push("older"));
		commitIfLatest(registry, newer, () => commits.push("newer"));

		expect(commits).toEqual(["newer"]);
	});

	test("keeps unrelated channels independent", () => {
		const registry = new LatestRequestRegistry();
		const firstTab = registry.issue("query:first");
		registry.issue("query:second");

		expect(registry.isLatest(firstTab)).toBe(true);
	});

	test("invalidateAll stales handles and checkpoints", () => {
		const registry = new LatestRequestRegistry();
		const handle = registry.issue("table:users");
		const checkpoint = registry.checkpoint("lifecycle");

		registry.invalidateAll();

		expect(registry.isLatest(handle)).toBe(false);
		expect(registry.isCurrent(checkpoint)).toBe(false);
	});

	test("batch continuation stops before another operation after invalidation", async () => {
		const registry = new LatestRequestRegistry();
		const lifecycle = registry.checkpoint("lifecycle");
		const completed: number[] = [];

		const finished = await continueWhileCurrent(
			[1, 2],
			() => registry.isCurrent(lifecycle),
			async (item) => {
				completed.push(item);
				registry.invalidateAll();
			},
		);

		expect(finished).toBe(false);
		expect(completed).toEqual([1]);
	});
});
