import { describe, expect, test } from "bun:test";
import {
	commitIfLatest,
	continueWhileCurrent,
	LatestRequestRegistry,
} from "./latestRequestRegistry";

describe("LatestRequestRegistry", () => {
	test("ignores an older table response after a newer request starts", () => {
		const registry = new LatestRequestRegistry();
		const older = registry.issue("table:users");
		const newer = registry.issue("table:users");
		const commits: string[] = [];

		commitIfLatest(registry, older, () => commits.push("older"));
		commitIfLatest(registry, newer, () => commits.push("newer"));

		expect(commits).toEqual(["newer"]);
	});

	test("ignores older query success and error commits", () => {
		const registry = new LatestRequestRegistry();
		const olderSuccess = registry.issue("query:one");
		const newer = registry.issue("query:one");
		const commits: string[] = [];

		commitIfLatest(registry, olderSuccess, () => commits.push("success"));
		commitIfLatest(registry, olderSuccess, () => commits.push("error"));
		commitIfLatest(registry, newer, () => commits.push("latest"));

		expect(commits).toEqual(["latest"]);
	});

	test("keeps channels independent", () => {
		const registry = new LatestRequestRegistry();
		const firstTab = registry.issue("query:first");
		registry.issue("query:second");

		expect(registry.isLatest(firstTab)).toBe(true);
	});

	test("invalidation makes an in-flight handle stale while the next remains allowed", () => {
		const registry = new LatestRequestRegistry();
		const inFlight = registry.issue("table:users");
		registry.invalidate("table:users");
		const latest = registry.issue("table:users");

		expect(registry.isLatest(inFlight)).toBe(false);
		expect(registry.isLatest(latest)).toBe(true);
	});

	test("invalidateAll stales handles and non-owning checkpoints", () => {
		const registry = new LatestRequestRegistry();
		const handle = registry.issue("table:users");
		const checkpoint = registry.checkpoint("table:users");

		registry.invalidateAll();

		expect(registry.isLatest(handle)).toBe(false);
		expect(registry.isCurrent(checkpoint)).toBe(false);
	});

	test("a table checkpoint is stale after paging or close but otherwise current", () => {
		const registry = new LatestRequestRegistry();
		const unchanged = registry.checkpoint("table:users");
		expect(registry.isCurrent(unchanged)).toBe(true);

		registry.issue("table:users");
		expect(registry.isCurrent(unchanged)).toBe(false);

		const beforeClose = registry.checkpoint("table:users");
		registry.invalidate("table:users");
		expect(registry.isCurrent(beforeClose)).toBe(false);
	});

	test("only the newest reversed async table completion commits", async () => {
		const registry = new LatestRequestRegistry();
		let resolveOlder!: () => void;
		let resolveNewer!: () => void;
		const olderDone = new Promise<void>((resolve) => (resolveOlder = resolve));
		const newerDone = new Promise<void>((resolve) => (resolveNewer = resolve));
		const commits: string[] = [];
		const run = async (name: string, done: Promise<void>) => {
			const handle = registry.issue("table:users");
			await done;
			commitIfLatest(registry, handle, () => commits.push(name));
		};

		const older = run("older", olderDone);
		const newer = run("newer", newerDone);
		resolveNewer();
		await newer;
		resolveOlder();
		await older;

		expect(commits).toEqual(["newer"]);
	});

	test("batch continuation stops before another operation after lifecycle invalidation", async () => {
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
