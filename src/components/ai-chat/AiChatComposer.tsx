import { ArrowUp, Stop } from "@phosphor-icons/react";
import { type FormEvent, useState } from "react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";

interface AiChatComposerProps {
	disabled: boolean;
	pending: boolean;
	placeholder: string;
	onSend: (text: string) => Promise<boolean>;
	onCancel: () => void;
}

export function AiChatComposer({
	disabled,
	pending,
	placeholder,
	onSend,
	onCancel,
}: AiChatComposerProps) {
	const [text, setText] = useState("");
	const canSend = !disabled && !pending && text.trim().length > 0;

	const submit = async (event?: FormEvent) => {
		event?.preventDefault();
		if (!canSend) return;
		const message = text;
		setText("");
		if (!(await onSend(message))) setText(message);
	};

	return (
		<form
			onSubmit={(event) => void submit(event)}
			className="border-t bg-card/60 p-2"
		>
			<div className="rounded-lg border bg-background focus-within:ring-2 focus-within:ring-ring/40">
				<Textarea
					aria-label="Ask about your data"
					value={text}
					disabled={disabled}
					placeholder={placeholder}
					onChange={(event) => setText(event.target.value)}
					onKeyDown={(event) => {
						if (
							event.key === "Enter" &&
							!event.shiftKey &&
							!event.nativeEvent.isComposing
						) {
							event.preventDefault();
							void submit();
						}
					}}
					className="max-h-40 min-h-16 resize-none border-0 bg-transparent text-sm shadow-none focus-visible:ring-0"
				/>
				<div className="flex items-center justify-between px-2 pb-2">
					<span className="text-[11px] text-muted-foreground">
						Enter to send · Shift+Enter for a new line
					</span>
					{pending ? (
						<Button
							type="button"
							size="icon-sm"
							variant="secondary"
							onClick={onCancel}
							aria-label="Stop"
						>
							<Stop weight="fill" />
						</Button>
					) : (
						<Button
							type="submit"
							size="icon-sm"
							disabled={!canSend}
							aria-label="Send"
						>
							<ArrowUp />
						</Button>
					)}
				</div>
			</div>
		</form>
	);
}
