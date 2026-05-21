import { CircleNotch } from "@phosphor-icons/react";
import { cn } from "@/lib/utils";

function Spinner({
	className,
	weight = "bold",
	...props
}: React.ComponentProps<typeof CircleNotch>) {
	return (
		<CircleNotch
			role="status"
			aria-label="Loading"
			weight={weight}
			className={cn("size-4 animate-spin bg-none text-current", className)}
			{...props}
		/>
	);
}

export { Spinner };
