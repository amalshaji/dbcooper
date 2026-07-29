import {
	CaretDown,
	PlayCircle,
	Warning,
	WarningCircle,
} from "@phosphor-icons/react";
import type { ReactNode } from "react";
import { Button } from "@/components/ui/button";
import {
	DropdownMenu,
	DropdownMenuContent,
	DropdownMenuItem,
	DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Spinner } from "@/components/ui/spinner";
import {
	Tooltip,
	TooltipContent,
	TooltipTrigger,
} from "@/components/ui/tooltip";

interface SqlEditorToolbarProps {
	value: string;
	toolbarActions?: ReactNode;
	onRunQuery?: () => void;
	onRunAllQueries?: () => void;
	cursorWarning?: string | null;
	disabled: boolean;
	draftVisible: boolean;
	executing: boolean;
}

export function SqlEditorToolbar({
	value,
	toolbarActions,
	onRunQuery,
	onRunAllQueries,
	cursorWarning,
	disabled,
	draftVisible,
	executing,
}: SqlEditorToolbarProps) {
	const runDisabled = disabled || draftVisible || executing || !value.trim();

	return (
		<div
			className={`z-10 flex gap-1 font-sans ${
				onRunQuery
					? "shrink-0 items-center justify-between border-b bg-muted/20 px-2 py-1"
					: "absolute top-2 right-2"
			}`}
		>
			<div className="flex items-center gap-1">
				{cursorWarning && (
					<Tooltip>
						<TooltipTrigger render={<div className="cursor-pointer" />}>
							<Warning className="size-5 text-amber-500" weight="fill" />
						</TooltipTrigger>
						<TooltipContent>{cursorWarning}</TooltipContent>
					</Tooltip>
				)}
				{!value.trim() && (
					<Tooltip>
						<TooltipTrigger render={<div className="cursor-pointer" />}>
							<WarningCircle className="size-5 text-red-500" weight="fill" />
						</TooltipTrigger>
						<TooltipContent>Query is empty - cannot execute</TooltipContent>
					</Tooltip>
				)}
			</div>
			{(toolbarActions || onRunQuery) && (
				<div className="flex items-center gap-2">
					{toolbarActions}
					{onRunQuery && (
						<div className="flex">
							<Button
								size="sm"
								onClick={onRunQuery}
								disabled={runDisabled}
								className="-mr-1 rounded-r-none border-r-0"
							>
								{executing ? <Spinner /> : null}
								Run query{" "}
								<span className="text-xs opacity-60">
									({navigator.platform.includes("Mac") ? "⌘" : "Ctrl"}+↵)
								</span>
							</Button>
							{onRunAllQueries && (
								<DropdownMenu>
									<DropdownMenuTrigger
										render={
											<Button
												size="sm"
												className="rounded-l-none border border-border px-1"
												disabled={runDisabled}
											>
												<CaretDown className="size-4" />
											</Button>
										}
									/>
									<DropdownMenuContent align="end">
										<DropdownMenuItem onClick={onRunAllQueries}>
											<PlayCircle className="size-4" />
											Run all queries
										</DropdownMenuItem>
									</DropdownMenuContent>
								</DropdownMenu>
							)}
						</div>
					)}
				</div>
			)}
		</div>
	);
}
