import { WarningCircle } from "@phosphor-icons/react";
import { lazy, Suspense } from "react";
import { Button } from "@/components/ui/button";
import { Spinner } from "@/components/ui/spinner";
import type { PendingAiChat, PendingPhase } from "@/hooks/useAiChat";
import type { AiChatMessage as AiChatMessageData } from "@/lib/tauri/aiChat";
import { AiChatResult } from "./AiChatResult";
import { AiChatSteps } from "./AiChatSteps";
import { AiChatWriteCard } from "./AiChatWriteCard";

const STOPPED = "Stopped";

const PENDING_LABEL: Record<PendingPhase, string> = {
	thinking: "Thinking…",
	writing: "Running the approved change…",
	rejecting: "Rejecting the change…",
};

const MessageResponse = lazy(() => import("./MessageResponse"));

function UserBubble({ text }: { text: string }) {
	return (
		<div className="ml-10 whitespace-pre-wrap break-words rounded-lg bg-muted px-3 py-2 text-sm">
			{text}
		</div>
	);
}

interface AiChatMessageProps {
	message: AiChatMessageData;
	connectionName: string;
	busy: boolean;
	onResolveWrite: (messageId: number, approve: boolean) => void;
	onOpenQuery?: (query: string) => void;
}

export function AiChatMessage({
	message,
	connectionName,
	busy,
	onResolveWrite,
	onOpenQuery,
}: AiChatMessageProps) {
	if (message.role === "user") return <UserBubble text={message.text} />;

	return (
		<div className="space-y-2">
			<AiChatSteps steps={message.steps} />
			{message.text ? (
				<Suspense
					fallback={
						<p className="whitespace-pre-wrap break-words text-sm leading-relaxed">
							{message.text}
						</p>
					}
				>
					<MessageResponse>{message.text}</MessageResponse>
				</Suspense>
			) : null}
			{message.error === STOPPED ? (
				<p className="text-xs text-muted-foreground">Stopped.</p>
			) : message.error ? (
				<p className="flex items-start gap-1.5 rounded-md bg-destructive/10 px-2 py-1.5 text-xs text-destructive">
					<WarningCircle className="mt-0.5 size-3.5 shrink-0" />
					<span className="min-w-0 break-words">{message.error}</span>
				</p>
			) : null}
			{message.write ? (
				<AiChatWriteCard
					write={message.write}
					connectionName={connectionName}
					disabled={busy}
					onResolve={(approve) => onResolveWrite(message.id, approve)}
				/>
			) : null}
			<AiChatResult message={message} onOpenQuery={onOpenQuery} />
		</div>
	);
}

export function PendingAiChatMessage({
	pending,
	onCancel,
}: {
	pending: PendingAiChat;
	onCancel: () => void;
}) {
	return (
		<>
			{pending.text ? <UserBubble text={pending.text} /> : null}
			<div className="space-y-2">
				<AiChatSteps steps={pending.steps} />
				<div className="flex items-center gap-2 text-xs text-muted-foreground">
					<Spinner className="size-3.5" />
					<span className="ai-shimmer">
						{PENDING_LABEL[pending.phase]}
					</span>
					{pending.phase === "thinking" ? (
						<Button
							variant="ghost"
							size="xs"
							className="ml-auto"
							onClick={onCancel}
						>
							Stop
						</Button>
					) : null}
				</div>
			</div>
		</>
	);
}
