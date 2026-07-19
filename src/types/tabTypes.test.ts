import { describe, expect, test } from "bun:test";
import {
	createFunctionDefinitionTab,
	createQueryTab,
	createRedisQueryTab,
	createSchemaVisualizerTab,
	createTableDataTab,
	createTableStructureTab,
} from "./tabTypes";

describe("tab factories", () => {
	test("produce distinct ids when created in the same timestamp", () => {
		const now = Date.now;
		Date.now = () => 123;
		try {
			const factories = [
				() => createTableDataTab("public.users"),
				() => createTableStructureTab("public.users"),
				() => createQueryTab(),
				() => createRedisQueryTab(),
				() => createSchemaVisualizerTab(),
				() =>
					createFunctionDefinitionTab({
						schema: "public",
						name: "lookup",
						identity_args: "integer",
						arguments: "value integer",
						return_type: "text",
						language: "sql",
					}),
			];
			for (const factory of factories) {
				expect(factory().id).not.toBe(factory().id);
			}
		} finally {
			Date.now = now;
		}
	});
});
