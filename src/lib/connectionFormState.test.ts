import { expect, test } from "bun:test";
import type { ConnectionFormData } from "@/types/connection";
import { mergeD1ConnectionFields } from "./connectionFormState";

test("merges D1 field changes into the latest form state", () => {
	const initial: ConnectionFormData = {
		type: "d1",
		db_type: "d1",
		name: "Production",
		host: "api.cloudflare.com",
		port: 443,
		database: "old-database",
		username: "old-account",
		password: "old-token",
		ssl: true,
	};

	const withAccount = mergeD1ConnectionFields(initial, {
		accountId: "new-account",
		databaseId: "",
	});
	const withToken = mergeD1ConnectionFields(withAccount, {
		apiToken: "new-token",
		databaseId: "",
	});

	expect(withToken.username).toBe("new-account");
	expect(withToken.password).toBe("new-token");
	expect(withToken.database).toBe("");
});
