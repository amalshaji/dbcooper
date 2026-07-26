import type { ConnectionType } from "@/types/connection";
import {
	getDatabasePolicy,
	type SqlFormatterLanguage,
} from "./databaseCatalog";

export function isFileDatabase(dbType: ConnectionType): boolean {
	return getDatabasePolicy(dbType).fileDatabase;
}

export function supportsStructuredRowMutations(
	dbType: ConnectionType,
): boolean {
	return getDatabasePolicy(dbType).structuredRowMutations;
}

export function getSqlFormatterLanguage(
	dbType: ConnectionType,
): SqlFormatterLanguage {
	return getDatabasePolicy(dbType).formatterLanguage;
}
