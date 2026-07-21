import { PlugsConnected, WarningCircle } from "@phosphor-icons/react";
import { useEffect, useState } from "react";
import { Label } from "@/components/ui/label";
import { Spinner } from "@/components/ui/spinner";
import { Switch } from "@/components/ui/switch";
import type { McpStatus } from "@/lib/tauri";
import { McpCredentials } from "./McpCredentials";
import { McpTokenDialog } from "./McpTokenDialog";

interface McpClient {
	getStatus: () => Promise<McpStatus>;
	setEnabled: (enabled: boolean) => Promise<McpStatus>;
	regenerateToken: () => Promise<McpStatus>;
}

interface McpSettingsProps {
	compact?: boolean;
	client: McpClient;
	copyText?: (value: string) => Promise<void>;
}

function errorMessage(error: unknown) {
	return error instanceof Error ? error.message : String(error);
}

export function McpSettings({
	compact,
	client,
	copyText = (value) => navigator.clipboard.writeText(value),
}: McpSettingsProps) {
	const [status, setStatus] = useState<McpStatus | null>(null);
	const [action, setAction] = useState<"toggle" | "regenerate" | null>(null);
	const [error, setError] = useState<string | null>(null);
	const [showToken, setShowToken] = useState(false);
	const [copied, setCopied] = useState<"url" | "token" | null>(null);
	const [confirmRegenerate, setConfirmRegenerate] = useState(false);

	useEffect(() => {
		let active = true;
		client
			.getStatus()
			.then((nextStatus) => active && setStatus(nextStatus))
			.catch((loadError) => active && setError(errorMessage(loadError)));
		return () => {
			active = false;
		};
	}, [client]);

	const handleEnabledChange = async (enabled: boolean) => {
		if (!status) return;
		const previousStatus = status;
		setError(null);
		setAction("toggle");
		setStatus({ ...status, enabled });
		try {
			setStatus(await client.setEnabled(enabled));
		} catch (toggleError) {
			setStatus(previousStatus);
			setError(errorMessage(toggleError));
		} finally {
			setAction(null);
		}
	};

	const handleCopy = async (field: "url" | "token", value: string) => {
		setError(null);
		try {
			await copyText(value);
			setCopied(field);
		} catch (copyError) {
			setError(`Could not copy: ${errorMessage(copyError)}`);
		}
	};

	const handleRegenerate = async () => {
		setError(null);
		setAction("regenerate");
		try {
			setStatus(await client.regenerateToken());
			setShowToken(false);
			setCopied(null);
			setConfirmRegenerate(false);
		} catch (regenerateError) {
			setError(errorMessage(regenerateError));
		} finally {
			setAction(null);
		}
	};

	const headingSize = compact ? "text-sm font-medium" : "text-lg font-medium";
	const sectionClass = compact
		? "space-y-3"
		: "space-y-4 border-b pb-6 last:border-b-0 last:pb-0";
	const statusText = action === "toggle"
		? status?.enabled
			? "Starting…"
			: "Stopping…"
		: status?.running
			? "Running"
			: status?.enabled
				? "Enabled, not running"
				: "Off";

	return (
		<div className={sectionClass}>
			<div>
				<h3 className={headingSize}>MCP server</h3>
				{!compact && (
					<p id="mcp-server-description" className="mt-1 text-xs text-muted-foreground">
						Let local AI clients inspect saved connections and run read-only
						queries.
					</p>
				)}
			</div>

			{status ? (
				<div className="overflow-hidden rounded-lg border bg-card/70">
					<div className="flex items-center justify-between px-3 py-3">
						<div className="flex min-w-0 items-center gap-2.5">
							<div className="flex size-8 shrink-0 items-center justify-center rounded-md bg-muted text-muted-foreground">
								<PlugsConnected className="size-4" />
							</div>
							<div className="min-w-0">
								<Label htmlFor="mcp-server-enabled">MCP server</Label>
								<p className="mt-0.5 flex items-center text-xs text-muted-foreground" aria-live="polite">
									<span
										className={`mr-1.5 size-1.5 rounded-full ${status.running ? "bg-emerald-500" : "bg-muted-foreground/50"}`}
									/>
									{statusText}
									{status.running && status.port ? ` · Port ${status.port}` : ""}
								</p>
							</div>
						</div>
						<Switch
							id="mcp-server-enabled"
							aria-label="MCP server"
							aria-describedby={!compact ? "mcp-server-description" : undefined}
							checked={status.enabled}
							disabled={action !== null}
							onCheckedChange={handleEnabledChange}
						/>
					</div>

					{status.enabled && (
						<McpCredentials
							status={status}
							showToken={showToken}
							copied={copied}
							onShowTokenChange={setShowToken}
							onCopy={handleCopy}
							onRegenerateRequest={() => setConfirmRegenerate(true)}
						/>
					)}
				</div>
			) : (
				<div className="flex items-center rounded-lg border bg-card/70 px-3 py-3 text-xs text-muted-foreground">
					<Spinner />
					<span className="ml-2">Loading MCP status…</span>
				</div>
			)}

			{error && (
				<p className="flex items-start text-xs text-destructive" role="alert">
					<WarningCircle className="mr-1.5 mt-px size-3.5 shrink-0" />
					{error}
				</p>
			)}
			<p className="sr-only" aria-live="polite">
				{copied === "url"
					? "MCP URL copied"
					: copied === "token"
						? "Bearer token copied"
						: ""}
			</p>

			<McpTokenDialog
				open={confirmRegenerate}
				busy={action === "regenerate"}
				onOpenChange={(open) =>
					action !== "regenerate" && setConfirmRegenerate(open)
				}
				onRegenerate={handleRegenerate}
			/>
		</div>
	);
}
