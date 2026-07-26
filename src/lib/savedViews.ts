import type { TableFilter } from "@/lib/resultFilters";
import type { SavedViewStateV1 } from "@/lib/tauri";
import type { SortConfig } from "@/types/tabTypes";

export const DEFAULT_COLUMN_WIDTH = 150;
export const MIN_COLUMN_WIDTH = 80;
export const MAX_COLUMN_WIDTH = 300;

export interface TableColumnLayout {
	columnOrder: string[];
	hiddenColumns: string[];
	columnWidths: Record<string, number>;
}

interface ReconciledSavedView {
	state: SavedViewStateV1 | null;
	layout: TableColumnLayout;
	warning: string | null;
	error: string | null;
}

export function createColumnLayout(columnNames: string[]): TableColumnLayout {
	return {
		columnOrder: [...columnNames],
		hiddenColumns: [],
		columnWidths: {},
	};
}

export function normalizeColumnLayout(
	layout: TableColumnLayout,
	columnNames: string[],
): TableColumnLayout {
	const available = new Set(columnNames);
	const ordered = layout.columnOrder.filter(
		(column, index, order) =>
			available.has(column) && order.indexOf(column) === index,
	);
	for (const column of columnNames) {
		if (!ordered.includes(column)) ordered.push(column);
	}

	let hiddenColumns = layout.hiddenColumns.filter(
		(column, index, hidden) =>
			available.has(column) && hidden.indexOf(column) === index,
	);
	if (ordered.length > 0 && hiddenColumns.length === ordered.length) {
		hiddenColumns = hiddenColumns.filter((column) => column !== ordered[0]);
	}

	const columnWidths = Object.fromEntries(
		Object.entries(layout.columnWidths)
			.filter(
				([column, width]) => available.has(column) && Number.isFinite(width),
			)
			.map(([column, width]) => [
				column,
				Math.min(MAX_COLUMN_WIDTH, Math.max(MIN_COLUMN_WIDTH, Math.round(width))),
			]),
	);

	return { columnOrder: ordered, hiddenColumns, columnWidths };
}

export function captureSavedViewState(
	filter: TableFilter | null,
	sort: SortConfig | null,
	layout: TableColumnLayout,
): SavedViewStateV1 {
	return {
		version: 1,
		filter,
		sort,
		column_order: [...layout.columnOrder],
		hidden_columns: [...layout.hiddenColumns],
		column_widths: { ...layout.columnWidths },
	};
}

export function reconcileSavedViewState(
	state: SavedViewStateV1,
	columnNames: string[],
): ReconciledSavedView {
	const layout = normalizeColumnLayout(
		{
			columnOrder: state.column_order,
			hiddenColumns: state.hidden_columns,
			columnWidths: state.column_widths,
		},
		columnNames,
	);

	if ((state.version as number) !== 1) {
		return {
			state: null,
			layout,
			warning: null,
			error: "This view was created by a newer version of DBcooper.",
		};
	}

	if (state.filter?.kind === "structured") {
		const available = new Set(columnNames);
		const missing = state.filter.value.conditions.find(
			(condition) => !available.has(condition.column),
		)?.column;
		if (missing) {
			return {
				state: null,
				layout,
				warning: null,
				error: `The saved filter uses missing column “${missing}”.`,
			};
		}
	}

	const sort =
		state.sort && columnNames.includes(state.sort.column) ? state.sort : null;
	const warning =
		state.sort && !sort
			? `The saved sort column “${state.sort.column}” no longer exists.`
			: null;

	return {
		state: captureSavedViewState(state.filter, sort, layout),
		layout,
		warning,
		error: null,
	};
}

export function isSavedViewStateEqual(
	left: SavedViewStateV1,
	right: SavedViewStateV1,
): boolean {
	const canonicalize = (state: SavedViewStateV1) => ({
		...state,
		column_widths: Object.fromEntries(
			Object.entries(state.column_widths).sort(([leftKey], [rightKey]) =>
				leftKey.localeCompare(rightKey),
			),
		),
	});

	return JSON.stringify(canonicalize(left)) === JSON.stringify(canonicalize(right));
}

export function moveColumn(
	columnOrder: string[],
	column: string,
	direction: -1 | 1,
): string[] {
	const index = columnOrder.indexOf(column);
	const target = index + direction;
	if (index < 0 || target < 0 || target >= columnOrder.length) {
		return [...columnOrder];
	}

	const next = [...columnOrder];
	[next[index], next[target]] = [next[target], next[index]];
	return next;
}

export function reorderColumn(
	columnOrder: string[],
	column: string,
	targetColumn: string,
): string[] {
	const sourceIndex = columnOrder.indexOf(column);
	const targetIndex = columnOrder.indexOf(targetColumn);
	if (sourceIndex < 0 || targetIndex < 0 || sourceIndex === targetIndex) {
		return [...columnOrder];
	}

	const next = [...columnOrder];
	next.splice(sourceIndex, 1);
	next.splice(targetIndex, 0, column);
	return next;
}
