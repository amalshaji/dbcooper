import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { ArrowsClockwise, CaretDown, CaretRight } from "@phosphor-icons/react";
import { PostgresqlIcon } from "@/components/icons/postgres";
import { RedisIcon } from "@/components/icons/redis";
import { getForgeGraphCredentialState } from "@/lib/forgegraph";
import { api, type ForgeGraphService } from "@/lib/tauri";
import { Spinner } from "@/components/ui/spinner";
import { toast } from "sonner";

interface ForgeGraphTreeProps {
	services: ForgeGraphService[];
	onSync: () => Promise<void>;
}

interface AppGroup {
	appSlug: string;
	appName: string;
	stages: Map<string, ForgeGraphService[]>;
}

function groupByApp(services: ForgeGraphService[]): AppGroup[] {
	const map = new Map<string, AppGroup>();
	for (const svc of services) {
		let group = map.get(svc.appSlug);
		if (!group) {
			group = {
				appSlug: svc.appSlug,
				appName: svc.appName,
				stages: new Map(),
			};
			map.set(svc.appSlug, group);
		}
		const stageServices = group.stages.get(svc.stage) || [];
		stageServices.push(svc);
		group.stages.set(svc.stage, stageServices);
	}
	return Array.from(map.values());
}

export function ForgeGraphTree({ services, onSync }: ForgeGraphTreeProps) {
	const navigate = useNavigate();
	const [syncing, setSyncing] = useState(false);
	const [expandedApps, setExpandedApps] = useState<Set<string>>(new Set());
	const [expandedStages, setExpandedStages] = useState<Set<string>>(new Set());
	const [connecting, setConnecting] = useState<string | null>(null);

	const apps = groupByApp(services);

	const handleSync = async () => {
		setSyncing(true);
		try {
			await onSync();
		} finally {
			setSyncing(false);
		}
	};

	const toggleApp = (slug: string) => {
		setExpandedApps((prev) => {
			const next = new Set(prev);
			if (next.has(slug)) next.delete(slug);
			else next.add(slug);
			return next;
		});
	};

	const toggleStage = (key: string) => {
		setExpandedStages((prev) => {
			const next = new Set(prev);
			if (next.has(key)) next.delete(key);
			else next.add(key);
			return next;
		});
	};

	const handleConnect = async (svc: ForgeGraphService) => {
		const key = `${svc.appSlug}:${svc.stage}:${svc.kind}`;
		if (isUnavailable(svc)) {
			toast.error(unavailableReason(svc));
			return;
		}
		if (svc.nodeStatus === "offline") {
			toast.error("Node is offline");
			return;
		}
		setConnecting(key);
		try {
			const result = await api.forgegraph.connect(
				svc.appSlug,
				svc.stage,
				svc.kind,
			);
			if (result.error) {
				toast.error(result.error);
				return;
			}
			const poolKey = await api.forgegraph.poolKey(
				svc.appSlug,
				svc.stage,
				svc.kind,
			);
			navigate(`/connections/${encodeURIComponent(poolKey)}`, {
				state: {
					forgegraph: true,
					appSlug: svc.appSlug,
					appName: svc.appName,
					stage: svc.stage,
					kind: svc.kind,
					nodeName: svc.nodeName,
					dbType: svc.kind === "postgres" ? "postgres" : "redis",
				},
			});
		} catch (error) {
			toast.error(String(error));
		} finally {
			setConnecting(null);
		}
	};

	const ServiceIcon = ({ kind }: { kind: string }) =>
		kind === "postgres" ? (
			<PostgresqlIcon className="size-4 shrink-0" />
		) : (
			<RedisIcon className="size-4 shrink-0" />
		);

	const StatusDot = ({ status }: { status: string }) => (
		<span
			className={`inline-block size-2 rounded-full shrink-0 ${
				status === "online"
					? "bg-green-500"
					: status === "degraded"
						? "bg-yellow-500"
						: "bg-gray-400"
			}`}
		/>
	);

	const isUnavailable = (svc: ForgeGraphService) =>
		getForgeGraphCredentialState(svc.config).status === "missing" ||
		svc.config.connectionAvailable === false;

	const unavailableReason = (svc: ForgeGraphService) => {
		if (getForgeGraphCredentialState(svc.config).status === "missing") {
			return "ForgeGraph has not configured a credential secret for this service.";
		}
		return typeof svc.config.connectionError === "string"
			? svc.config.connectionError
			: "ForgeGraph has not published credentials for this service.";
	};

	if (apps.length === 0) {
		return (
			<div className="px-3 py-2">
				<div className="flex items-center justify-between mb-2">
					<span className="text-xs font-medium text-muted-foreground uppercase tracking-wider">
						ForgeGraph
					</span>
					<Button
						variant="ghost"
						size="sm"
						className="h-6 w-6 p-0"
						onClick={handleSync}
						disabled={syncing}
					>
						{syncing ? (
							<Spinner className="size-3" />
						) : (
							<ArrowsClockwise className="size-3" />
						)}
					</Button>
				</div>
				<p className="text-xs text-muted-foreground">No services found</p>
			</div>
		);
	}

	return (
		<div className="px-3 py-2">
			<div className="flex items-center justify-between mb-2">
				<span className="text-xs font-medium text-muted-foreground uppercase tracking-wider">
					ForgeGraph
				</span>
				<Button
					variant="ghost"
					size="sm"
					className="h-6 w-6 p-0"
					onClick={handleSync}
					disabled={syncing}
				>
					{syncing ? (
						<Spinner className="size-3" />
					) : (
						<ArrowsClockwise className="size-3" />
					)}
				</Button>
			</div>

			<div className="space-y-0.5">
				{apps.map((app) => {
					const appExpanded = expandedApps.has(app.appSlug);
					return (
						<div key={app.appSlug}>
							<button
								type="button"
								className="flex items-center gap-1.5 w-full px-2 py-1 text-sm rounded hover:bg-accent text-left"
								onClick={() => toggleApp(app.appSlug)}
							>
								{appExpanded ? (
									<CaretDown className="size-3" />
								) : (
									<CaretRight className="size-3" />
								)}
								<span className="truncate font-medium">{app.appName}</span>
							</button>

							{appExpanded &&
								Array.from(app.stages.entries()).map(
									([stageName, stageServices]) => {
										const stageKey = `${app.appSlug}:${stageName}`;
										const stageExpanded = expandedStages.has(stageKey);
										return (
											<div key={stageKey} className="ml-3">
												<button
													type="button"
													className="flex items-center gap-1.5 w-full px-2 py-1 text-sm rounded hover:bg-accent text-left"
													onClick={() => toggleStage(stageKey)}
												>
													{stageExpanded ? (
														<CaretDown className="size-3" />
													) : (
														<CaretRight className="size-3" />
													)}
													<span className="truncate text-muted-foreground">
														{stageName}
													</span>
												</button>

												{stageExpanded &&
													stageServices.map((svc) => {
														const svcKey = `${svc.appSlug}:${svc.stage}:${svc.kind}`;
														const isConnecting = connecting === svcKey;
														const unavailable = isUnavailable(svc);
														const credentialState =
															getForgeGraphCredentialState(svc.config);
														return (
															<button
																key={svcKey}
																type="button"
																className={`flex items-center gap-2 w-full ml-3 px-2 py-1 text-sm rounded text-left disabled:cursor-not-allowed disabled:hover:bg-transparent ${
																	unavailable
																		? "opacity-60"
																		: "hover:bg-accent"
																}`}
																onClick={() => handleConnect(svc)}
																title={
																	unavailable
																		? unavailableReason(svc)
																		: undefined
																}
																disabled={isConnecting || unavailable}
															>
																<StatusDot status={svc.nodeStatus} />
																<ServiceIcon kind={svc.kind} />
																<span className="truncate">
																	{svc.kind === "postgres"
																		? (svc.config.dbName as string) ||
																			svc.appSlug
																		: svc.appSlug}
																</span>
																<Badge
																	variant="outline"
																	className="ml-auto text-[10px] px-1 py-0"
																>
																	{unavailable
																		? credentialState.status === "missing"
																			? "no secret"
																			: "setup"
																		: svc.kind === "postgres"
																			? "pg"
																			: "redis"}
																</Badge>
																{credentialState.status === "configured" && (
																	<Badge
																		variant="secondary"
																		className="text-[10px] px-1 py-0"
																	>
																		{credentialState.label}
																	</Badge>
																)}
																{isConnecting && <Spinner className="size-3" />}
															</button>
														);
													})}
											</div>
										);
									},
								)}
						</div>
					);
				})}
			</div>
		</div>
	);
}
