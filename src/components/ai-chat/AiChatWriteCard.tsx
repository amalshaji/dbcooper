import { CheckCircle, PencilSimpleLine, WarningCircle, XCircle } from "@phosphor-icons/react";
import { Button } from "@/components/ui/button";
import type { AiChatWrite } from "@/lib/tauri/aiChat";

interface AiChatWriteCardProps {
	write: AiChatWrite;
	connectionName: string;
	disabled: boolean;
	onResolve: (approve: boolean) => void;
}

function WriteOutcome({ write }: { write: AiChatWrite }) {
	switch (write.status) {
		case "executed":
			return (
				<p className="flex items-center gap-1.5 text-xs text-muted-foreground">
					<CheckCircle className="size-3.5 shrink-0" weight="fill" />
					Ran
					{write.rows_affected !== null
						? ` · ${write.rows_affected.toLocaleString()} rows affected`
						: ""}
				</p>
			);
		case "failed":
			return (
				<p className="flex items-start gap-1.5 text-xs text-destructive">
					<WarningCircle className="mt-0.5 size-3.5 shrink-0" />
					<span className="min-w-0 break-words">Failed: {write.error}</span>
				</p>
			);
		case "executing":
			return (
				<p className="flex items-center gap-1.5 text-xs text-muted-foreground">
					<WarningCircle className="size-3.5 shrink-0" />
					Started, but the outcome is unknown. Check the data before retrying.
				</p>
			);
		case "rejected":
			return (
				<p className="flex items-center gap-1.5 text-xs text-muted-foreground">
					<XCircle className="size-3.5 shrink-0" />
					Not run
				</p>
			);
		default:
			return null;
	}
}

export function AiChatWriteCard({
	write,
	connectionName,
	disabled,
	onResolve,
}: AiChatWriteCardProps) {
	const pending = write.status === "pending";
	return (
		<div className="space-y-2 rounded-lg border bg-card p-3">
			<p className="flex items-center gap-1.5 text-xs font-medium">
				<PencilSimpleLine className="size-3.5 shrink-0" />
				{pending
					? `Proposed change to ${connectionName}`
					: "Proposed change"}
			</p>
			<pre className="max-h-48 overflow-auto whitespace-pre-wrap break-words rounded-md bg-muted/50 p-2 font-mono text-[11px]">
				{write.display}
			</pre>
			{pending ? (
				<div className="flex items-center justify-end gap-1.5">
					<Button
						variant="ghost"
						size="sm"
						disabled={disabled}
						onClick={() => onResolve(false)}
					>
						Reject
					</Button>
					<Button size="sm" disabled={disabled} onClick={() => onResolve(true)}>
						Approve & run
					</Button>
				</div>
			) : (
				<WriteOutcome write={write} />
			)}
		</div>
	);
}
