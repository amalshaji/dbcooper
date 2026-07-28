import { describe, expect, test } from "bun:test";
import { isDockerDatabaseEngine } from "./docker";

describe("Docker database engines", () => {
	test("narrows only catalog-backed engine values", () => {
		expect(isDockerDatabaseEngine("mysql")).toBe(true);
		expect(isDockerDatabaseEngine("mariadb")).toBe(true);
		expect(isDockerDatabaseEngine("unknown")).toBe(false);
		expect(isDockerDatabaseEngine(null)).toBe(false);
	});
});
