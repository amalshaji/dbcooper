import { describe, expect, test } from "bun:test";
import { generateUuidV4, type UuidCrypto } from "./uuid";

describe("generateUuidV4", () => {
	test("uses the native randomUUID implementation when available", () => {
		let fallbackUsed = false;
		const source: UuidCrypto = {
			randomUUID: () => "native-uuid",
			getRandomValues: (array) => {
				fallbackUsed = true;
				return array;
			},
		};

		expect(generateUuidV4(source)).toBe("native-uuid");
		expect(fallbackUsed).toBe(false);
	});

	test("creates unique RFC v4 UUIDs when randomUUID is unavailable", () => {
		let seed = 0;
		const source: UuidCrypto = {
			getRandomValues: (array) => {
				const bytes = array as Uint8Array;
				for (let index = 0; index < bytes.length; index += 1) {
					bytes[index] = seed + index;
				}
				seed += 16;
				return array;
			},
		};

		const first = generateUuidV4(source);
		const second = generateUuidV4(source);
		expect(first).toMatch(
			/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/,
		);
		expect(second).toMatch(
			/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/,
		);
		expect(second).not.toBe(first);
	});
});
