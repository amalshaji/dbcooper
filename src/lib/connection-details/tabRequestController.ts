import {
	commitIfLatest,
	LatestRequestRegistry,
	type RequestHandle,
} from "./latestRequestRegistry";

export interface CurrentRequest {
	isCurrent(): boolean;
	commit(commit: () => void): boolean;
}

export class TabRequestController {
	private readonly registry = new LatestRequestRegistry();

	reset(): void {
		this.registry.invalidateAll();
	}

	beginTable(tabId: string): CurrentRequest {
		return this.request(this.registry.issue(this.tableChannel(tabId)));
	}

	watchTable(tabId: string): CurrentRequest {
		return this.request(this.registry.checkpoint(this.tableChannel(tabId)));
	}

	beginQuery(tabId: string): CurrentRequest {
		return this.request(this.registry.issue(this.queryChannel(tabId)));
	}

	watchLifecycle(): CurrentRequest {
		return this.request(this.registry.checkpoint("lifecycle"));
	}

	invalidateTab(tabId: string): void {
		this.registry.invalidate(this.tableChannel(tabId));
		this.registry.invalidate(this.queryChannel(tabId));
	}

	private request(handle: RequestHandle): CurrentRequest {
		return {
			isCurrent: () => this.registry.isCurrent(handle),
			commit: (commit) => commitIfLatest(this.registry, handle, commit),
		};
	}

	private tableChannel(tabId: string): string {
		return `table:${tabId}`;
	}

	private queryChannel(tabId: string): string {
		return `query:${tabId}`;
	}
}
