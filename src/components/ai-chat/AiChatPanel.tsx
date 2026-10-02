import {
	CaretDown,
	Check,
	NotePencil,
	Sparkle,
	Trash,
	X,
} from "@phosphor-icons/react";
import { Button } from "@/components/ui/button";
import {
	DropdownMenu,
	DropdownMenuContent,
	DropdownMenuItem,
	DropdownMenuLabel,
	DropdownMenuSeparator,
	DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Spinner } from "@/components/ui/spinner";
import { useAiChat } from "@/hooks/useAiChat";
import {
	type ConnectionWorkspace,
	getConnectionCapabilities,
} from "@/lib/connectionCapabilities";
import type { Connection } from "@/types/connection";
import { AiChatComposer } from "./AiChatComposer";
import { AiChatMessage, PendingAiChatMessage } from "./AiChatMessage";
import {
	Conversation,
	ConversationContent,
	ConversationScrollButton,
} from "./Conversation";

const SUGGESTIONS: Record<ConnectionWorkspace, string[]> = {
	sql: [
		"Which tables have the most rows?",
		"Show new records per week over the last 3 months",
		"Summarize what this database stores",
	],
	"key-value": [
		"How many keys are there per prefix?",
		"What types of keys are stored here?",
	],
	document: [
		"Which collections are the largest?",
		"Show documents created per day this month",
	],
};

interface AiChatPanelProps {
	connection: Connection;
	onClose: () => void;
	onOpenSettings: () => void;
	onOpenQuery?: (query: string) => void;
}

export function AiChatPanel({
	connection,
	onClose,
	onOpenSettings,
	onOpenQuery,
}: AiChatPanelProps) {
	const chat = useAiChat(connection.uuid);
	const activeConversation = chat.conversations.find(
		(conversation) => conversation.id === chat.activeConversationId,
	);
	const busy = chat.pending !== null;
	const empty = chat.messages.length === 0 && !busy && !chat.loadingMessages;
	const suggestions =
		SUGGESTIONS[getConnectionCapabilities(connection.type).workspace];

	return (
		<div className="flex h-full min-h-0 flex-col">
			<header className="flex h-10 shrink-0 items-center gap-1 border-b px-2">
				<Sparkle className="size-4 shrink-0 text-primary" />
				<DropdownMenu>
					<DropdownMenuTrigger
						disabled={busy}
						render={
							<Button
								variant="ghost"
								size="sm"
								className="min-w-0 max-w-full justify-start"
							>
								<span className="truncate">
									{activeConversation?.title ?? "New chat"}
								</span>
								<CaretDown className="size-3 shrink-0" />
							</Button>
						}
					/>
					<DropdownMenuContent className="w-72">
						<DropdownMenuLabel>Conversations</DropdownMenuLabel>
						{chat.conversations.length === 0 ? (
							<DropdownMenuItem disabled>No saved conversations</DropdownMenuItem>
						) : (
							chat.conversations.map((conversation) => (
								<DropdownMenuItem
									key={conversation.id}
									onClick={() => void chat.selectConversation(conversation.id)}
								>
									<span className="min-w-0 flex-1 truncate">
										{conversation.title}
									</span>
									{conversation.id === chat.activeConversationId ? (
										<Check className="size-3.5" />
									) : null}
								</DropdownMenuItem>
							))
						)}
						{activeConversation ? (
							<>
								<DropdownMenuSeparator />
								<DropdownMenuItem
									variant="destructive"
									onClick={() =>
										void chat.deleteConversation(activeConversation.id)
									}
								>
									<Trash />
									Delete this conversation
								</DropdownMenuItem>
							</>
						) : null}
					</DropdownMenuContent>
				</DropdownMenu>
				<div className="ml-auto flex items-center">
					<Button
						variant="ghost"
						size="icon-sm"
						onClick={chat.startNewConversation}
						disabled={busy}
						aria-label="New chat"
						title="New chat"
					>
						<NotePencil />
					</Button>
					<Button
						variant="ghost"
						size="icon-sm"
						onClick={onClose}
						aria-label="Close Ask AI"
						title="Close Ask AI (⌘I)"
					>
						<X />
					</Button>
				</div>
			</header>

			<Conversation>
				<ConversationContent>
					{chat.loadingMessages ? (
						<div className="flex justify-center py-8">
							<Spinner />
						</div>
					) : null}
					{empty ? (
						<div className="space-y-4 py-6">
							<div>
								<p className="text-sm font-medium">Ask about your data</p>
								<p className="mt-1 text-xs text-muted-foreground">
									Ask AI runs read-only queries against {connection.name} and
									charts the results. Changes like creating tables or adding
									data only run after you approve them. Query results may be
									sent to your AI provider; limit what it can see in Settings.
								</p>
							</div>
							{chat.configured === false ? (
								<div className="rounded-md border bg-muted/30 p-3 text-xs">
									<p className="text-muted-foreground">
										Set up an AI provider to start asking questions.
									</p>
									<Button
										size="sm"
										variant="outline"
										className="mt-2"
										onClick={onOpenSettings}
									>
										Open Settings
									</Button>
								</div>
							) : (
								<div className="flex flex-wrap gap-1.5">
									{suggestions.map((suggestion) => (
										<Button
											key={suggestion}
											variant="outline"
											size="sm"
											className="h-auto whitespace-normal rounded-full px-3 py-1.5 text-left"
											disabled={chat.configured !== true}
											onClick={() => void chat.send(suggestion)}
										>
											{suggestion}
										</Button>
									))}
								</div>
							)}
						</div>
					) : null}
					{chat.messages.map((message) => (
						<AiChatMessage
							key={message.id}
							message={message}
							connectionName={connection.name}
							busy={busy}
							onResolveWrite={(messageId, approve) =>
								void chat.resolveWrite(messageId, approve)
							}
							onOpenQuery={onOpenQuery}
						/>
					))}
					{chat.pending ? (
						<PendingAiChatMessage pending={chat.pending} onCancel={chat.cancel} />
					) : null}
				</ConversationContent>
				<ConversationScrollButton />
			</Conversation>

			<AiChatComposer
				disabled={chat.configured !== true}
				pending={busy}
				cancellable={chat.pending?.phase === "thinking"}
				placeholder={
					chat.configured === false
						? "Configure AI in Settings to ask questions"
						: "Ask a question about your data…"
				}
				onSend={chat.send}
				onCancel={chat.cancel}
			/>
		</div>
	);
}
