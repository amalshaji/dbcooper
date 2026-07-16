const DEFAULT_VISIBLE_ROW_CAPACITY = 30;

export function shouldVirtualizeRows(
	requested: boolean,
	rowCount: number,
): boolean {
	return requested && rowCount > DEFAULT_VISIBLE_ROW_CAPACITY;
}
