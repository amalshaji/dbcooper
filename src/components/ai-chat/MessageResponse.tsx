import type { ComponentProps } from "react";
import { defaultRehypePlugins, Streamdown } from "streamdown";
import "streamdown/styles.css";
import { cn } from "@/lib/utils";

/**
 * Answers are written by a model that has read untrusted database content, so
 * links render as plain text and images are dropped: a crafted URL could
 * otherwise navigate the webview or leak data through an image request. Raw
 * HTML is dropped entirely (no rehype-raw), not just sanitized.
 */
const SAFE_COMPONENTS = {
	a: ({ children }: ComponentProps<"a">) => (
		<span className="underline decoration-dotted underline-offset-2">
			{children}
		</span>
	),
	img: () => null,
};

const REHYPE_PLUGINS = [defaultRehypePlugins.sanitize, defaultRehypePlugins.harden];

export function MessageResponse({
	children,
	className,
}: {
	children: string;
	className?: string;
}) {
	return (
		<Streamdown
			mode="static"
			rehypePlugins={REHYPE_PLUGINS}
			controls={false}
			linkSafety={{ enabled: false }}
			components={SAFE_COMPONENTS}
			className={cn(
				"text-sm leading-relaxed break-words [&>*:first-child]:mt-0 [&>*:last-child]:mb-0",
				className,
			)}
		>
			{children}
		</Streamdown>
	);
}

export default MessageResponse;
