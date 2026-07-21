import { Input as InputPrimitive } from "@base-ui/react/input";
import type * as React from "react";

import { cn } from "@/lib/utils";

function Input({ className, type, ...props }: React.ComponentProps<"input">) {
	return (
		<InputPrimitive
			type={type}
			data-slot="input"
			autoCapitalize="off"
			autoCorrect="off"
			spellCheck={false}
			className={cn(
				"dark:bg-input/25 border-input focus-visible:border-ring focus-visible:ring-ring/35 aria-invalid:ring-destructive/20 dark:aria-invalid:ring-destructive/40 aria-invalid:border-destructive dark:aria-invalid:border-destructive/50 disabled:bg-input/50 dark:disabled:bg-input/70 h-8 rounded-md border bg-card/70 px-2.5 py-1 text-xs shadow-[0_1px_0_color-mix(in_oklch,white_5%,transparent)_inset] transition-[border-color,box-shadow,background-color] file:h-6 file:text-xs file:font-medium focus-visible:ring-2 aria-invalid:ring-1 md:text-xs file:text-foreground placeholder:text-muted-foreground/80 w-full min-w-0 outline-none file:inline-flex file:border-0 file:bg-transparent disabled:pointer-events-none disabled:cursor-not-allowed disabled:opacity-50",
				className,
			)}
			{...props}
		/>
	);
}

export { Input };
