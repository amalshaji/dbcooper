import { describe, expect, test } from "bun:test";
import { commitIfLatest, LatestRequestRegistry } from "./latestRequestRegistry";

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
});
