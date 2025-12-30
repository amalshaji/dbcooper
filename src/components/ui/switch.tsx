import * as React from "react";
import { cn } from "@/lib/utils";

interface SwitchProps
	extends Omit<React.InputHTMLAttributes<HTMLInputElement>, "size"> {
	onCheckedChange?: (checked: boolean) => void;
	size?: "default" | "sm";
}

const Switch = React.forwardRef<HTMLInputElement, SwitchProps>(
	(
		{ className, onCheckedChange, checked, size = "default", ...props },
		ref,
	) => {
		const isSmall = size === "sm";

		return (
			<label
				className={cn(
					"relative inline-flex shrink-0 cursor-pointer items-center rounded-full border-2 border-transparent transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background disabled:cursor-not-allowed disabled:opacity-50",
					isSmall ? "h-4 w-7" : "h-6 w-11",
					checked ? "bg-primary" : "bg-input",
					className,
				)}
			>
				<input
					type="checkbox"
					className="sr-only"
					ref={ref}
					checked={checked}
					onChange={(e) => onCheckedChange?.(e.target.checked)}
					{...props}
				/>
				<span
					className={cn(
						"pointer-events-none block rounded-full bg-background shadow-lg ring-0 transition-transform",
						isSmall ? "h-3 w-3" : "h-5 w-5",
						checked
							? isSmall
								? "translate-x-3"
								: "translate-x-5"
							: "translate-x-0",
					)}
				/>
			</label>
		);
	},
);
Switch.displayName = "Switch";

export { Switch };
