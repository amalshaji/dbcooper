import type { Tab } from "../../types/tabTypes";

export type TabChanges<T extends Tab> = Partial<Omit<T, "id" | "type">>;

export type UpdateTab<T extends Tab> = (
	tabId: string,
	changes: TabChanges<T>,
) => void;

export type TabPatch = {
	[K in Tab["type"]]: {
		type: K;
		tabId: string;
		changes: TabChanges<Extract<Tab, { type: K }>>;
	};
}[Tab["type"]];

export type DispatchTabPatch = (patch: TabPatch) => void;

export function applyTabPatch(tabs: Tab[], patch: TabPatch): Tab[] {
	return tabs.map((tab) => {
		if (tab.id !== patch.tabId || tab.type !== patch.type) return tab;
		return { ...tab, ...patch.changes } as Tab;
	});
}
