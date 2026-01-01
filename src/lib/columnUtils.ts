import type { TableColumn } from "@/types/tabTypes";

/**
 * Check if a column is UUID-related based on its name or type.
 */
export function isUuidColumn(column: TableColumn): boolean {
	const columnNameLower = column.name.toLowerCase();
	const columnTypeLower = column.type.toLowerCase();
	return (
		columnNameLower.includes("uuid") ||
		columnTypeLower === "uuid" ||
		columnTypeLower.includes("uuid")
	);
}

/**
 * Generate a UUID v4 using the Web Crypto API.
 */
export function generateUUIDv4(): string {
	return crypto.randomUUID();
}
