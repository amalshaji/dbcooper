import { useEffect, useRef, useState } from "react";
import { useVirtualizer } from "@tanstack/react-virtual";
import { listen } from "@tauri-apps/api/event";
import { Check, Copy, Plus } from "@phosphor-icons/react";
import { toast } from "sonner";
import { ExpandableText } from "@/components/ExpandableText";
import { RedisKeySheet } from "@/components/RedisKeySheet";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import {
	Sheet,
	SheetContent,
	SheetDescription,
	SheetHeader,
	SheetTitle,
} from "@/components/ui/sheet";
import {
	AlertDialog,
	AlertDialogAction,
	AlertDialogCancel,
	AlertDialogContent,
	AlertDialogDescription,
	AlertDialogFooter,
	AlertDialogHeader,
	AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Skeleton } from "@/components/ui/skeleton";
import { Spinner } from "@/components/ui/spinner";
import {
	api,
	type Connection,
	type RedisKeyDetails,
	type RedisKeyInfo,
} from "@/lib/tauri";
export function RedisWorkspace({ connection }: { connection: Connection }) {
	// Redis-specific state (no tabs for Redis)
	const [redisPattern, setRedisPattern] = useState("*");
	const [redisKeys, setRedisKeys] = useState<RedisKeyInfo[] | null>(null);
	const [redisSelectedKey, setRedisSelectedKey] = useState<string | null>(null);
	const [redisKeyDetails, setRedisKeyDetails] =
		useState<RedisKeyDetails | null>(null);
	const [loadingRedisKeys, setLoadingRedisKeys] = useState(false);
	const [loadingRedisDetails, setLoadingRedisDetails] = useState(false);
	const [redisSheetOpen, setRedisSheetOpen] = useState(false);
	const [copiedToClipboard, setCopiedToClipboard] = useState(false);
	const [showDeleteDialog, setShowDeleteDialog] = useState(false);
	const [redisSearchTime, setRedisSearchTime] = useState<number | null>(null);
	const [redisKeySheetOpen, setRedisKeySheetOpen] = useState(false);
	const [redisKeySheetMode, setRedisKeySheetMode] = useState<"add" | "edit">(
		"add",
	);
	const [savingRedisKey, setSavingRedisKey] = useState(false);
	const [redisScanProgress, setRedisScanProgress] = useState<{
		iteration: number;
		maxIterations: number;
		keysFound: number;
	} | null>(null);
	const [redisScanCursor, setRedisScanCursor] = useState<number | null>(null);
	const [redisScanComplete, setRedisScanComplete] = useState<boolean>(true);
	const [redisScanBaseCount, setRedisScanBaseCount] = useState<number>(0);

	// Ref for Redis keys list virtualization
	const redisKeysListRef = useRef<HTMLDivElement>(null);

	// Virtualizer for Redis keys list
	const redisKeysVirtualizer = useVirtualizer({
		count: redisKeys?.length ?? 0,
		getScrollElement: () => redisKeysListRef.current,
		estimateSize: () => 48,
		overscan: 10,
	});

	// Listen for Redis scan progress events
	useEffect(() => {
		let isMounted = true;
		let unlistenFn: (() => void) | null = null;

		const setupListener = async () => {
			const unlisten = await listen<{
				uuid: string;
				iteration: number;
				max_iterations: number;
				keys_found: number;
				keys: string[];
			}>("redis-scan-progress", (event) => {
				if (event.payload.uuid === connection.uuid) {
					setRedisScanProgress({
						iteration: event.payload.iteration,
						maxIterations: event.payload.max_iterations,
						keysFound: event.payload.keys_found,
					});
					// Append new keys as they stream in
					if (event.payload.keys.length > 0) {
						setRedisKeys((prev) => {
							const newKeys: RedisKeyInfo[] = event.payload.keys.map((key) => ({
								key,
								key_type: "",
								ttl: -2,
							}));
							return [...(prev || []), ...newKeys];
						});
					}
				}
			});

			if (isMounted) {
				unlistenFn = unlisten;
			} else {
				unlisten();
			}
		};

		setupListener();

		return () => {
			isMounted = false;
			unlistenFn?.();
		};
	}, [connection.uuid]);

	// Redis-specific handlers (simple view without tabs)
	// ============================================================================

	const handleRedisSearch = async () => {
		if (!connection) return;
		setLoadingRedisKeys(true);
		setRedisSelectedKey(null);
		setRedisKeyDetails(null);
		setRedisSearchTime(null);
		setRedisScanProgress(null);
		setRedisScanCursor(null);
		setRedisScanComplete(true);
		setRedisScanBaseCount(0); // Reset base count for new search
		setRedisKeys([]); // Clear keys before starting - they will be streamed in via events

		try {
			const result = await api.redis.searchKeys(
				connection.uuid,
				redisPattern,
				100,
				0,
			);
			// Keys are streamed via events, so we don't need to set them here
			// But we still need the final metadata from the result
			setRedisSearchTime(result.time_taken_ms ?? null);
			setRedisScanCursor(result.cursor);
			setRedisScanComplete(result.scan_complete);
		} catch (error) {
			console.error("Failed to search Redis keys:", error);
			toast.error("Failed to search keys");
		} finally {
			setLoadingRedisKeys(false);
			setRedisScanProgress(null);
		}
	};

	const handleRedisScanMore = async () => {
		if (!connection || redisScanComplete || redisScanCursor == null) return;
		setLoadingRedisKeys(true);
		setRedisScanProgress(null);
		setRedisScanBaseCount(redisKeys?.length ?? 0); // Track existing keys for cumulative progress

		try {
			const result = await api.redis.searchKeys(
				connection.uuid,
				redisPattern,
				100,
				redisScanCursor,
			);
			// Keys are streamed via events, so we don't need to append them here
			setRedisSearchTime((prev) => {
				const current = result.time_taken_ms;
				if (prev == null || current == null) {
					return null;
				}
				return prev + current;
			});
			setRedisScanCursor(result.cursor);
			setRedisScanComplete(result.scan_complete);
		} catch (error) {
			console.error("Failed to scan more Redis keys:", error);
			toast.error("Failed to scan more keys");
		} finally {
			setLoadingRedisKeys(false);
			setRedisScanProgress(null);
		}
	};

	const handleRedisKeySelect = async (key: string) => {
		if (!connection) return;

		setRedisSelectedKey(key);
		setLoadingRedisDetails(true);
		setRedisSheetOpen(true);

		try {
			const details = await api.redis.getKeyDetails(connection.uuid, key);
			setRedisKeyDetails(details);
		} catch (error) {
			console.error("Failed to get Redis key details:", error);
			toast.error("Failed to load key details");
			setRedisSheetOpen(false);
		} finally {
			setLoadingRedisDetails(false);
		}
	};

	const handleRedisDeleteKey = async () => {
		setShowDeleteDialog(false);
		if (!connection || !redisSelectedKey) return;

		try {
			await api.redis.deleteKey(connection.uuid, redisSelectedKey);
			toast.success("Key deleted successfully");
			// Close sheet, refresh keys list, and clear selection
			setRedisSheetOpen(false);
			handleRedisSearch();
			setRedisSelectedKey(null);
			setRedisKeyDetails(null);
		} catch (error) {
			console.error("Failed to delete Redis key:", error);
			toast.error("Failed to delete key");
		}
	};

	const handleCopyValue = () => {
		if (!redisKeyDetails) return;
		const valueString = JSON.stringify(redisKeyDetails.value, null, 2);
		navigator.clipboard.writeText(valueString);
		setCopiedToClipboard(true);
		toast.success("Copied to clipboard");
		setTimeout(() => setCopiedToClipboard(false), 2000);
	};

	const handleRedisAddKey = () => {
		setRedisKeySheetMode("add");
		setRedisKeySheetOpen(true);
	};

	const handleRedisEditKey = () => {
		setRedisKeySheetMode("edit");
		setRedisKeySheetOpen(true);
	};

	const handleRedisSaveKey = async (data: {
		key: string;
		type: "string" | "list" | "set" | "hash" | "zset";
		value: unknown;
		ttl?: number;
	}) => {
		if (!connection) return;

		setSavingRedisKey(true);
		try {
			switch (data.type) {
				case "string":
					await api.redis.setKey(
						connection.uuid,
						data.key,
						data.value as string,
						data.ttl,
					);
					break;
				case "list":
					await api.redis.setListKey(
						connection.uuid,
						data.key,
						data.value as string[],
						data.ttl,
					);
					break;
				case "set":
					await api.redis.setSetKey(
						connection.uuid,
						data.key,
						data.value as string[],
						data.ttl,
					);
					break;
				case "hash":
					await api.redis.setHashKey(
						connection.uuid,
						data.key,
						data.value as Record<string, string>,
						data.ttl,
					);
					break;
				case "zset":
					await api.redis.setZSetKey(
						connection.uuid,
						data.key,
						data.value as Array<[string, number]>,
						data.ttl,
					);
					break;
			}

			toast.success(
				`Key "${data.key}" ${redisKeySheetMode === "add" ? "created" : "updated"} successfully`,
			);
			setRedisKeySheetOpen(false);
			handleRedisSearch();
			if (redisKeySheetMode === "edit") {
				setRedisSheetOpen(false);
				setRedisSelectedKey(null);
				setRedisKeyDetails(null);
			}
		} catch (error) {
			console.error("Failed to save Redis key:", error);
			toast.error(
				`Failed to ${redisKeySheetMode === "add" ? "create" : "update"} key`,
			);
		} finally {
			setSavingRedisKey(false);
		}
	};

	const renderRedisView = () => (
		<div className="flex flex-col h-full gap-4">
			{/* Pattern Search */}
			<Card>
				<CardContent className="pt-6">
					<div className="flex items-center gap-2">
						<Input
							placeholder="Enter pattern (e.g., *, user:*, cache:*)"
							value={redisPattern}
							onChange={(e) => setRedisPattern(e.target.value)}
							onKeyDown={(e) => {
								if (e.key === "Enter" && !loadingRedisKeys) {
									handleRedisSearch();
								}
							}}
							disabled={loadingRedisKeys}
							className="flex-1 font-mono"
							autoFocus
						/>
						<Button onClick={handleRedisSearch} disabled={loadingRedisKeys}>
							{loadingRedisKeys ? <Spinner /> : null}
							Search Keys
						</Button>
						<Button onClick={handleRedisAddKey} variant="default">
							<Plus className="w-4 h-4" />
							Add Key
						</Button>
					</div>
					{redisKeys !== null && (
						<div className="mt-2 text-sm text-muted-foreground">
							Found {redisKeys.length} key{redisKeys.length !== 1 ? "s" : ""}
							{redisSearchTime !== null && (
								<span className="ml-2">• {redisSearchTime}ms</span>
							)}
						</div>
					)}
				</CardContent>
			</Card>

			{/* Results */}
			<Card className="flex-1 overflow-hidden flex flex-col">
				<CardHeader className="pb-3">
					<CardTitle className="text-base">Keys</CardTitle>
				</CardHeader>
				<CardContent
					className="flex-1 overflow-y-auto p-0"
					ref={redisKeysListRef}
				>
					{redisKeys && redisKeys.length > 0 ? (
						<div
							style={{
								height: `${redisKeysVirtualizer.getTotalSize()}px`,
								position: "relative",
							}}
						>
							{redisKeysVirtualizer.getVirtualItems().map((virtualItem) => {
								const keyInfo = redisKeys[virtualItem.index];
								return (
									<div
										key={virtualItem.key}
										data-index={virtualItem.index}
										ref={redisKeysVirtualizer.measureElement}
										style={{
											position: "absolute",
											top: 0,
											left: 0,
											width: "100%",
											height: `${virtualItem.size}px`,
											transform: `translateY(${virtualItem.start}px)`,
										}}
									>
										<button
											type="button"
											onClick={() => handleRedisKeySelect(keyInfo.key)}
											className="w-full h-full text-left px-4 hover:bg-muted/50 transition-colors border-b flex items-center"
										>
											<span className="font-mono text-sm truncate flex-1">
												{keyInfo.key}
											</span>
										</button>
									</div>
								);
							})}
						</div>
					) : loadingRedisKeys ? (
						<div className="flex flex-col items-center justify-center py-8 gap-2">
							<Spinner />
							{redisScanProgress && (
								<div className="text-sm text-muted-foreground">
									Scanning... {redisScanBaseCount + redisScanProgress.keysFound}{" "}
									keys found ({redisScanProgress.iteration}/
									{redisScanProgress.maxIterations} iterations)
								</div>
							)}
						</div>
					) : redisKeys && redisKeys.length === 0 ? (
						<div className="text-center py-12 text-muted-foreground">
							No keys found matching pattern "{redisPattern}"
							{!redisScanComplete && (
								<div className="mt-4">
									<Button
										onClick={handleRedisScanMore}
										variant="outline"
										size="sm"
									>
										Scan More Keys
									</Button>
								</div>
							)}
						</div>
					) : (
						<div className="text-center py-12 text-muted-foreground">
							Enter a pattern and click Search to find keys
						</div>
					)}
				</CardContent>
				{loadingRedisKeys && redisKeys && redisKeys.length > 0 && (
					<div className="border-t p-3 flex items-center justify-center gap-2">
						<Spinner />
						{redisScanProgress && (
							<span className="text-sm text-muted-foreground">
								Scanning... {redisScanBaseCount + redisScanProgress.keysFound}{" "}
								keys found ({redisScanProgress.iteration}/
								{redisScanProgress.maxIterations} iterations)
							</span>
						)}
					</div>
				)}
				{!redisScanComplete &&
					redisKeys &&
					redisKeys.length > 0 &&
					!loadingRedisKeys && (
						<div className="border-t p-3 flex items-center justify-center gap-2">
							<span className="text-sm text-muted-foreground">
								Scan incomplete
							</span>
							<Button onClick={handleRedisScanMore} variant="outline" size="sm">
								Scan More Keys
							</Button>
						</div>
					)}
			</Card>

			{/* Key Details Sheet */}
			<Sheet open={redisSheetOpen} onOpenChange={setRedisSheetOpen}>
				<SheetContent className="w-full sm:max-w-2xl overflow-y-auto">
					<div className="">
						{loadingRedisDetails ? (
							<>
								<SheetHeader>
									<SheetTitle>Key Details</SheetTitle>
									<SheetDescription className="flex items-center gap-2">
										<Spinner />
										Loading key details
									</SheetDescription>
								</SheetHeader>
								<div className="mt-2 space-y-6 px-4">
									{/* Metadata skeleton */}
									<div>
										<h3 className="text-sm font-medium mb-3">Metadata</h3>
										<div className="space-y-3 text-sm">
											<div>
												<span className="text-muted-foreground">Key:</span>
												<Skeleton className="mt-1 h-8 w-full rounded" />
											</div>
											<div className="grid grid-cols-2 gap-4">
												<div className="space-y-1">
													<span className="text-muted-foreground">Type:</span>
													<Skeleton className="h-4 w-16 rounded" />
												</div>
												<div className="space-y-1">
													<span className="text-muted-foreground">TTL:</span>
													<Skeleton className="h-4 w-24 rounded" />
												</div>
												<div className="space-y-1">
													<span className="text-muted-foreground">
														Encoding:
													</span>
													<Skeleton className="h-4 w-20 rounded" />
												</div>
												<div className="space-y-1">
													<span className="text-muted-foreground">Memory:</span>
													<Skeleton className="h-4 w-20 rounded" />
												</div>
											</div>
										</div>
									</div>
									{/* Value skeleton */}
									<div>
										<h3 className="text-sm font-medium mb-3">Value</h3>
										<Skeleton className="h-32 w-full rounded-md" />
									</div>
									{/* Actions skeleton */}
									<div className="flex gap-2 pt-4 border-t">
										<Skeleton className="h-9 w-24 rounded" />
										<Skeleton className="h-9 w-16 rounded" />
									</div>
								</div>
							</>
						) : redisKeyDetails ? (
							<>
								<SheetHeader>
									<SheetTitle>Key Details</SheetTitle>
									<SheetDescription>
										Viewing details for Redis key
									</SheetDescription>
								</SheetHeader>
								<div className="mt-2 space-y-6 px-4">
									{/* Key metadata */}
									<div>
										<h3 className="text-sm font-medium mb-3">Metadata</h3>
										<div className="space-y-3 text-sm">
											{/* Key - full width */}
											<div>
												<span className="text-muted-foreground">Key:</span>
												<div className="mt-1 font-mono bg-muted px-3 py-2 rounded text-xs break-all">
													{redisKeyDetails.key}
												</div>
											</div>
											{/* Other metadata in grid */}
											<div className="grid grid-cols-2 gap-4">
												<div>
													<span className="text-muted-foreground">Type:</span>
													<span className="ml-2">
														{redisKeyDetails.key_type}
													</span>
												</div>
												<div>
													<span className="text-muted-foreground">TTL:</span>
													<span className="ml-2">
														{redisKeyDetails.ttl === -1
															? "No expiration"
															: `${redisKeyDetails.ttl}s`}
													</span>
												</div>
												{redisKeyDetails.encoding && (
													<div>
														<span className="text-muted-foreground">
															Encoding:
														</span>
														<span className="ml-2">
															{redisKeyDetails.encoding}
														</span>
													</div>
												)}
												{redisKeyDetails.size !== undefined && (
													<div>
														<span className="text-muted-foreground">
															Memory:
														</span>
														<span className="ml-2">
															{redisKeyDetails.size} bytes
														</span>
													</div>
												)}
												{redisKeyDetails.length !== undefined && (
													<div>
														<span className="text-muted-foreground">
															Length:
														</span>
														<span className="ml-2">
															{redisKeyDetails.length}
														</span>
													</div>
												)}
											</div>
										</div>
									</div>

									{/* Value */}
									<div>
										<div className="flex items-center justify-between mb-3">
											<h3 className="text-sm font-medium">Value</h3>
											<Button
												variant="ghost"
												size="sm"
												onClick={handleCopyValue}
												className="h-7 px-2"
											>
												{copiedToClipboard ? (
													<>
														<Check className="w-4 h-4 mr-1" />
														Copied!
													</>
												) : (
													<>
														<Copy className="w-4 h-4 mr-1" />
														Copy
													</>
												)}
											</Button>
										</div>
										<ExpandableText
											value={JSON.stringify(redisKeyDetails.value, null, 2)}
											isJson={typeof redisKeyDetails.value === "object"}
										/>
									</div>

									{/* Actions */}
									<div className="flex gap-2 pt-4 border-t">
										<Button variant="default" onClick={handleRedisEditKey}>
											Edit Key
										</Button>
										<Button
											variant="destructive"
											onClick={() => setShowDeleteDialog(true)}
										>
											Delete Key
										</Button>
										<Button
											variant="outline"
											onClick={() => setRedisSheetOpen(false)}
										>
											Close
										</Button>
									</div>
								</div>
							</>
						) : (
							<div className="flex items-center justify-center py-12 px-4 text-muted-foreground">
								Failed to load key details
							</div>
						)}
					</div>
				</SheetContent>
			</Sheet>

			{/* Delete Confirmation Dialog */}
			<AlertDialog open={showDeleteDialog} onOpenChange={setShowDeleteDialog}>
				<AlertDialogContent>
					<AlertDialogHeader>
						<AlertDialogTitle>Delete Redis Key?</AlertDialogTitle>
						<AlertDialogDescription>
							Are you sure you want to delete the key{" "}
							<span className="font-mono bg-muted px-2 py-0.5 rounded">
								{redisSelectedKey}
							</span>
							? This action cannot be undone.
						</AlertDialogDescription>
					</AlertDialogHeader>
					<AlertDialogFooter>
						<AlertDialogCancel>Cancel</AlertDialogCancel>
						<AlertDialogAction
							onClick={handleRedisDeleteKey}
							variant="destructive"
						>
							Delete
						</AlertDialogAction>
					</AlertDialogFooter>
				</AlertDialogContent>
			</AlertDialog>

			{/* Add/Edit Key Sheet */}
			<RedisKeySheet
				open={redisKeySheetOpen}
				onOpenChange={setRedisKeySheetOpen}
				mode={redisKeySheetMode}
				keyDetails={redisKeySheetMode === "edit" ? redisKeyDetails : null}
				onSave={handleRedisSaveKey}
				saving={savingRedisKey}
			/>
		</div>
	);

	return renderRedisView();
}
