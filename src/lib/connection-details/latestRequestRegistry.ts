declare const requestHandleBrand: unique symbol;

export interface RequestHandle {
	readonly channel: string;
	readonly [requestHandleBrand]: true;
}

export class LatestRequestRegistry {
	private readonly latestByChannel = new Map<string, RequestHandle>();

	issue(channel: string): RequestHandle {
		const handle = { channel } as RequestHandle;
		this.latestByChannel.set(channel, handle);
		return handle;
	}

	isLatest(handle: RequestHandle): boolean {
		return this.latestByChannel.get(handle.channel) === handle;
	}

	invalidate(channel: string): void {
		this.latestByChannel.delete(channel);
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
