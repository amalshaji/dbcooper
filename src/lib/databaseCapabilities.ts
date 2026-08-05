import type { ConnectionType } from "@/types/connection";
import { getConnectionCapabilities } from "./connectionCapabilities";
import {
	getDatabasePolicy,
	type SqlPolicyType,
	type SqlFormatterLanguage,
} from "./databaseCatalog";

export function isFileDatabase(dbType: ConnectionType): boolean {
	return getConnectionCapabilities(dbType).fileDatabase;
}

export function supportsStructuredRowMutations(
	dbType: ConnectionType,
): boolean {
	return getConnectionCapabilities(dbType).structuredRowMutations;
}

export function loadsRelationalSchema(dbType: ConnectionType): boolean {
	return getConnectionCapabilities(dbType).loadsSchema;
}

export function getSqlFormatterLanguage(
	dbType: SqlPolicyType,
): SqlFormatterLanguage {
	return getDatabasePolicy(dbType).formatterLanguage;
}
