import { describe, expect, test } from "bun:test";
import { getConnectionDatabaseDisplay } from "./connectionPresentation";

describe("connection database presentation", () => {
	test("does not expose a Cloudflare D1 database UUID", () => {
		expect(
			getConnectionDatabaseDisplay({
				type: "d1",
				database: "564bb1ee-d00d-48b0-a35b-cae425ccc0e4",
			}),
		).toBe("Cloudflare D1");
	});

	test("preserves database names for other connection types", () => {
		expect(
			getConnectionDatabaseDisplay({
				type: "postgres",
				database: "analytics",
			}),
		).toBe("analytics");
	});
});
