import { Check, Plus, Sparkle, X } from "@phosphor-icons/react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Spinner } from "@/components/ui/spinner";
import { classifySqlIntent } from "@/lib/sqlSafety";

interface SqlAIPreviewProps {
	sql: string;
	hasExistingSql: boolean;
	generating: boolean;
	onReplace: () => void;
	onAppend: () => void;
	onDiscard: () => void;
}

export function SqlAIPreview({
	sql,
	hasExistingSql,
	generating,
	onReplace,
	onAppend,
	onDiscard,
}: SqlAIPreviewProps) {
	const intent = classifySqlIntent(sql);
	const intentLabel =
		intent === "read"
			? "Read only"
			: intent === "write"
				? "Writes data"
				: "Checking intent";

	return (
		<section className="overflow-hidden rounded-xl border border-primary/20 bg-primary/[0.035] shadow-sm">
			<header className="flex items-center justify-between border-b border-primary/10 px-3 py-2">
				<div className="flex items-center text-xs font-medium">
					{generating ? (
						<Spinner className="size-3.5" />
					) : (
						<Sparkle className="size-3.5 text-primary" />
					)}
					AI draft
				</div>
				<div className="flex items-center">
					<Badge
						variant="outline"
						className={
							intent === "write"
								? "border-destructive/30 bg-destructive/5 text-[10px] font-normal text-destructive"
								: "border-primary/20 bg-background/70 text-[10px] font-normal"
						}
					>
						{intentLabel}
					</Badge>
					<Badge
						variant="outline"
						className="border-primary/20 bg-background/70 text-[10px] font-normal"
					>
						Not executed
					</Badge>
				</div>
			</header>
			<pre className="max-h-48 overflow-auto whitespace-pre-wrap px-3 py-3 font-mono text-xs leading-5 text-foreground">
				{sql || "Preparing a query from the current editor and schema…"}
			</pre>
			<footer className="flex items-center justify-end border-t border-primary/10 bg-background/50 px-2 py-2">
				<Button
					variant="ghost"
					size="sm"
					onClick={onDiscard}
					disabled={generating}
				>
					<X /> Discard
				</Button>
				{hasExistingSql && (
					<Button
						variant="ghost"
						size="sm"
						onClick={onAppend}
						disabled={generating || !sql}
					>
						<Plus /> Append
					</Button>
				)}
				<Button size="sm" onClick={onReplace} disabled={generating || !sql}>
					<Check /> Use in editor
				</Button>
			</footer>
		</section>
	);
}
