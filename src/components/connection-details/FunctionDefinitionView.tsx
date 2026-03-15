import { useState } from "react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
	Card,
	CardContent,
	CardDescription,
	CardHeader,
	CardTitle,
} from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { SqlEditor } from "@/components/SqlEditor";
import type { FunctionDefinitionTab } from "@/types/tabTypes";
import { formatFunctionSignature } from "@/types/tabTypes";
import { Code, Copy } from "@phosphor-icons/react";

interface FunctionDefinitionViewProps {
	tab: FunctionDefinitionTab;
}

export function FunctionDefinitionView({
	tab,
}: FunctionDefinitionViewProps) {
	const [copying, setCopying] = useState(false);
	const displayDefinition = tab.definition?.definition.trimEnd() || "";
	const definitionHeight = displayDefinition
		? `${Math.min(Math.max(displayDefinition.split(/\r?\n/).length, 3), 24) * 22}px`
		: "66px";

	const handleCopy = async () => {
		if (!tab.definition?.definition || copying) {
			return;
		}

		setCopying(true);
		try {
			await navigator.clipboard.writeText(tab.definition.definition);
			toast.success("Function definition copied");
		} catch (error) {
			toast.error("Failed to copy function definition", {
				description: error instanceof Error ? error.message : String(error),
			});
		} finally {
			setCopying(false);
		}
	};

	return (
		<Card>
			<CardHeader>
				<div className="flex items-center justify-between gap-4">
					<div className="min-w-0">
						<CardTitle className="truncate">
							{formatFunctionSignature(tab.functionSummary)}
						</CardTitle>
						<CardDescription>
							Read-only function signature and definition
						</CardDescription>
					</div>
					<Button
						variant="outline"
						size="sm"
						onClick={handleCopy}
						disabled={!tab.definition || copying}
					>
						<Copy className="h-4 w-4" />
						Copy Definition
					</Button>
				</div>
			</CardHeader>
			<CardContent className="space-y-6">
				{tab.loading ? (
					<div className="space-y-4">
						<div className="flex flex-wrap gap-2">
							{[...Array(4)].map((_, index) => (
								<Skeleton key={index} className="h-6 w-28 rounded" />
							))}
						</div>
						<Skeleton className="h-80 w-full rounded" />
					</div>
				) : tab.error ? (
					<div className="rounded-md border border-destructive/20 bg-destructive/10 p-4 text-sm text-destructive">
						{tab.error}
					</div>
				) : tab.definition ? (
					<>
						<div className="flex flex-wrap gap-2">
							<Badge variant="secondary">{tab.definition.schema}</Badge>
							<Badge variant="secondary">{tab.definition.language}</Badge>
							<Badge variant="secondary">
								Returns {tab.definition.return_type}
							</Badge>
						</div>
						<div className="space-y-2">
							<div className="text-sm font-medium">Arguments</div>
							<div className="rounded-md border bg-muted/20 px-3 py-2 font-mono text-xs text-muted-foreground">
								{tab.definition.arguments || "None"}
							</div>
						</div>
						<div className="space-y-2">
							<div className="flex items-center gap-2 text-sm font-medium">
								<Code className="h-4 w-4" />
								Definition
							</div>
							<SqlEditor
								value={displayDefinition}
								onChange={() => undefined}
								height={definitionHeight}
								disabled
							/>
						</div>
					</>
				) : (
					<div className="text-sm text-muted-foreground">
						Function definition is unavailable.
					</div>
				)}
			</CardContent>
		</Card>
	);
}
