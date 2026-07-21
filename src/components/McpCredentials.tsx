import { Check, Copy, Eye, EyeSlash } from "@phosphor-icons/react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import type { McpStatus } from "@/lib/tauri";

interface McpCredentialsProps {
	status: McpStatus;
	showToken: boolean;
	copied: "url" | "token" | null;
	onShowTokenChange: (visible: boolean) => void;
	onCopy: (field: "url" | "token", value: string) => void;
	onRegenerateRequest: () => void;
}

export function McpCredentials({
	status,
	showToken,
	copied,
	onShowTokenChange,
	onCopy,
	onRegenerateRequest,
}: McpCredentialsProps) {
	return (
		<div className="space-y-4 border-t px-3 py-3">
			<div className="space-y-1.5">
				<Label htmlFor="mcp-url">MCP URL</Label>
				<div className="flex items-center gap-2">
					<Input
						id="mcp-url"
						aria-label="MCP URL"
						readOnly
						value={status.url ?? "Waiting for server…"}
						className="font-mono"
					/>
					<Button
						type="button"
						variant="outline"
						size="icon"
						disabled={!status.url}
						onClick={() => status.url && onCopy("url", status.url)}
						aria-label="Copy MCP URL"
					>
						{copied === "url" ? <Check /> : <Copy />}
					</Button>
				</div>
			</div>

			<div className="space-y-1.5">
				<Label htmlFor="mcp-token">Bearer token</Label>
				<div className="flex items-center gap-2">
					<Input
						id="mcp-token"
						aria-label="Bearer token"
						type={showToken ? "text" : "password"}
						readOnly
						value={status.token}
						className="font-mono"
					/>
					<Button
						type="button"
						variant="outline"
						size="icon"
						onClick={() => onShowTokenChange(!showToken)}
						aria-label={showToken ? "Hide bearer token" : "Show bearer token"}
					>
						{showToken ? <EyeSlash /> : <Eye />}
					</Button>
					<Button
						type="button"
						variant="outline"
						size="icon"
						onClick={() => onCopy("token", status.token)}
						aria-label="Copy bearer token"
					>
						{copied === "token" ? <Check /> : <Copy />}
					</Button>
				</div>
			</div>

			<div className="flex items-start justify-between border-t pt-3">
				<p className="max-w-sm text-xs leading-relaxed text-muted-foreground">
					Regenerating signs out every configured MCP client.
				</p>
				<Button
					type="button"
					variant="outline"
					size="sm"
					onClick={onRegenerateRequest}
				>
					Regenerate token
				</Button>
			</div>
		</div>
	);
}
