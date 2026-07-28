declare const requestHandleBrand: unique symbol;

export interface RequestHandle {
	readonly channel: string;
	readonly revision: number;
	readonly epoch: number;
	readonly [requestHandleBrand]: true;
}

export type RequestCheckpoint = RequestHandle;

export class LatestRequestRegistry {
	private readonly revisions = new Map<string, number>();
	private epoch = 0;

	issue(channel: string): RequestHandle {
		const revision = this.nextRevision(channel);
		return { channel, revision, epoch: this.epoch } as RequestHandle;
	}

	isLatest(handle: RequestHandle): boolean {
		return this.isCurrent(handle);
	}

	invalidate(channel: string): void {
		this.nextRevision(channel);
	}

	invalidateAll(): void {
		this.epoch += 1;
		this.revisions.clear();
	}

	checkpoint(channel: string): RequestCheckpoint {
		return {
			channel,
			revision: this.revisions.get(channel) ?? 0,
			epoch: this.epoch,
		} as RequestCheckpoint;
	}

	isCurrent(checkpoint: RequestCheckpoint): boolean {
		return (
			checkpoint.epoch === this.epoch &&
			checkpoint.revision === (this.revisions.get(checkpoint.channel) ?? 0)
		);
	}

	private nextRevision(channel: string): number {
		const revision = (this.revisions.get(channel) ?? 0) + 1;
		this.revisions.set(channel, revision);
		return revision;
	}
}

export function commitIfLatest(
	registry: LatestRequestRegistry,
	handle: RequestHandle,
	commit: () => void,
): boolean {
	if (!registry.isLatest(handle)) return false;
	commit();
	return true;
}

export async function continueWhileCurrent<T, R>(
	items: Iterable<T>,
	isCurrent: () => boolean,
	operation: (item: T) => Promise<R>,
	onCompleted?: (result: R, item: T) => void,
): Promise<boolean> {
	for (const item of items) {
		if (!isCurrent()) return false;
		const result = await operation(item);
		if (!isCurrent()) return false;
		onCompleted?.(result, item);
	}
	return true;
}
