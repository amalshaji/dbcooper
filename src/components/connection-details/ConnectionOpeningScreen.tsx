import { Check, Database, X } from "@phosphor-icons/react";
import { CloudflareIcon } from "@/components/icons/cloudflare";
import { ClickhouseIcon } from "@/components/icons/clickhouse";
import { DuckdbIcon } from "@/components/icons/duckdb";
import { MariadbIcon } from "@/components/icons/mariadb";
import { MysqlIcon } from "@/components/icons/mysql";
import { PostgresqlIcon } from "@/components/icons/postgres";
import { RedisIcon } from "@/components/icons/redis";
import { SqliteIcon } from "@/components/icons/sqlite";
import { DuckDbHelperProgress } from "@/components/DuckDbHelperProgress";
import { Spinner } from "@/components/ui/spinner";
import type { DuckDbHelperProgress as DuckDbHelperProgressValue } from "@/lib/duckdbHelper";
import type { Connection } from "@/lib/tauri";

export type LoadingPhase =
	| "fetching-config"
	| "preparing-duckdb"
	| "establishing-ssh"
	| "connecting"
	| "loading-schema"
	| "complete";

export function DatabaseIcon({
	connection,
}: {
	connection: Connection | null;
}) {
	if (!connection) return null;

	switch (connection.type) {
		case "postgres":
			return <PostgresqlIcon className="size-8" />;
		case "mysql":
			return <MysqlIcon className="size-8" />;
		case "mariadb":
			return <MariadbIcon className="size-8" />;
		case "sqlite":
			return <SqliteIcon className="size-8" />;
		case "duckdb":
			return <DuckdbIcon className="size-8" />;
		case "redis":
			return <RedisIcon className="size-8" />;
		case "clickhouse":
			return <ClickhouseIcon className="size-8" />;
		case "d1":
			return <CloudflareIcon className="h-4 w-8" />;
		default:
			return <Database className="size-8" />;
	}
}

interface ConnectionOpeningScreenProps {
	connection: Connection | null;
	loadingPhase: LoadingPhase;
	connectionStatus: "connected" | "disconnected";
	duckDbHelperProgress: DuckDbHelperProgressValue | null;
}

export function ConnectionOpeningScreen({
	connection,
	loadingPhase,
	connectionStatus,
	duckDbHelperProgress,
}: ConnectionOpeningScreenProps) {
	const loadingPhases: Array<{ phase: LoadingPhase; label: string }> = [
		{ phase: "fetching-config", label: "Fetching connection details" },
		...(connection?.type === "duckdb"
			? [
					{
						phase: "preparing-duckdb" as LoadingPhase,
						label: "Preparing DuckDB support",
					},
				]
			: []),
		...(connection?.ssh_enabled
			? [
					{
						phase: "establishing-ssh" as LoadingPhase,
						label: "Establishing SSH tunnel and connecting",
					},
				]
			: [
					{
						phase: "connecting" as LoadingPhase,
						label: "Establishing connection",
					},
				]),
		...(connection?.type !== "redis"
			? [
					{
						phase: "loading-schema" as LoadingPhase,
						label: "Loading schema and objects",
					},
				]
			: []),
	];

	const getPhaseStatus = (phase: LoadingPhase) => {
		const phaseIndex = loadingPhases.findIndex((item) => item.phase === phase);
		const currentIndex = loadingPhases.findIndex(
			(item) => item.phase === loadingPhase,
		);

		if (phaseIndex < currentIndex) return "complete";
		if (phaseIndex === currentIndex && loadingPhase !== "complete") {
			return "active";
		}
		return "pending";
	};

	return (
		<div className="workspace-canvas flex h-screen items-center justify-center p-6">
			<div className="workspace-panel w-full max-w-sm rounded-xl border p-5 shadow-sm">
				<div className="mb-4 flex items-center border-b pb-4">
					<div className="flex size-10 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary">
						{connection ? (
							<DatabaseIcon connection={connection} />
						) : (
							<Database className="size-5" />
						)}
					</div>
					<div className="ml-3 min-w-0">
						<p className="section-label">Opening workspace</p>
						<p className="mt-0.5 truncate text-sm font-semibold">
							{connection?.name ?? "Database connection"}
						</p>
					</div>
				</div>
				<div className="flex min-w-0 flex-col gap-2.5">
					{loadingPhases.map((phaseInfo) => {
						const status = getPhaseStatus(phaseInfo.phase);
						const showConnectionStatus =
							phaseInfo.phase === "connecting" &&
							loadingPhase !== "fetching-config" &&
							connectionStatus !== "connected";

						return (
							<div key={phaseInfo.phase}>
								<div className="flex items-center gap-3">
									<div className="flex size-5 shrink-0 items-center justify-center">
										{status === "complete" ? (
											<Check className="size-4 text-emerald-600" />
										) : status === "active" ? (
											showConnectionStatus &&
											connectionStatus === "disconnected" ? (
												<X className="size-4 text-destructive" />
											) : (
												<Spinner className="size-4" />
											)
										) : (
											<div className="size-1.5 rounded-full bg-muted-foreground/30" />
										)}
									</div>
									<span
										className={`flex-1 text-xs ${
											status === "complete"
												? "text-muted-foreground"
												: status === "active"
													? showConnectionStatus &&
														connectionStatus === "disconnected"
														? "font-medium text-destructive"
														: "text-foreground font-medium"
													: "text-muted-foreground/50"
										}`}
									>
										{showConnectionStatus && connectionStatus === "disconnected"
											? "Connection failed"
											: phaseInfo.label}
									</span>
								</div>
								{phaseInfo.phase === "preparing-duckdb" &&
									status === "active" &&
									duckDbHelperProgress && (
										<div className="ml-8 mt-2">
											<DuckDbHelperProgress progress={duckDbHelperProgress} />
										</div>
									)}
							</div>
						);
					})}
				</div>
			</div>
		</div>
	);
}
