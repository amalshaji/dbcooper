import { describe, expect, test } from "bun:test";
import { classifySqlIntent } from "./sqlSafety";

describe("classifySqlIntent", () => {
	test("recognizes read-only SQL after comments", () => {
		expect(classifySqlIntent("-- generated\nSELECT * FROM users")).toBe("read");
	});

	test("flags data and schema mutations", () => {
		expect(classifySqlIntent("UPDATE users SET active = false")).toBe("write");
		expect(classifySqlIntent("DROP TABLE users")).toBe("write");
	});

	test("keeps incomplete streamed SQL unknown", () => {
		expect(classifySqlIntent("SEL")).toBe("unknown");
	});
});
