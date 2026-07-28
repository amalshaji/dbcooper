import type { ConnectionFormData } from "@/types/connection";

interface D1ConnectionFieldChanges {
	accountId?: string;
	apiToken?: string;
	databaseId?: string;
}

export function mergeD1ConnectionFields(
	current: ConnectionFormData,
	changes: D1ConnectionFieldChanges,
): ConnectionFormData {
	return {
		...current,
		username: changes.accountId ?? current.username,
		password: changes.apiToken ?? current.password,
		database: changes.databaseId ?? current.database,
	};
}
