// Adapted from Vercel AI Elements (Apache-2.0): https://github.com/vercel/ai-elements
import { ArrowDown } from "@phosphor-icons/react";
import type { ComponentProps } from "react";
import { StickToBottom, useStickToBottomContext } from "use-stick-to-bottom";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

export function Conversation({
	className,
	...props
}: ComponentProps<typeof StickToBottom>) {
	return (
		<StickToBottom
			className={cn("relative min-h-0 flex-1 overflow-y-hidden", className)}
			initial="smooth"
			resize="smooth"
			role="log"
			{...props}
		/>
	);
}

export function ConversationContent({
	className,
	...props
}: ComponentProps<typeof StickToBottom.Content>) {
	return (
		<StickToBottom.Content
			className={cn("flex flex-col gap-5 px-3 py-3", className)}
			{...props}
		/>
	);
}

export function ConversationScrollButton() {
	const { isAtBottom, scrollToBottom } = useStickToBottomContext();
	if (isAtBottom) return null;
	return (
		<Button
			type="button"
			variant="outline"
			size="icon-sm"
			className="absolute bottom-3 left-1/2 -translate-x-1/2 rounded-full shadow-sm"
			onClick={() => void scrollToBottom()}
			aria-label="Scroll to latest message"
		>
			<ArrowDown />
		</Button>
	);
}
