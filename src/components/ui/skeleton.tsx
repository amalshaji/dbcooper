import { cn } from "@/lib/utils";

function Skeleton({ className, ...props }: React.ComponentProps<"div">) {
	return (
		<div
			data-slot="skeleton"
			className={cn(
				"bg-muted rounded-none animate-pulse dark:bg-foreground/15",
				className,
			)}
			{...props}
		/>
	);
}

export { Skeleton };
