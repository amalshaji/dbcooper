import { Button } from "@/components/ui/button";

interface EmptyStateAction {
	label: string;
	onClick: () => void;
	variant?: React.ComponentProps<typeof Button>["variant"];
}

interface EmptyStateProps {
	icon?: React.ReactNode;
	title: string;
	description: string;
	action?: EmptyStateAction;
	actions?: EmptyStateAction[];
}

export function EmptyState({
	icon,
	title,
	description,
	action,
	actions,
}: EmptyStateProps) {
	const resolvedActions = actions ?? (action ? [action] : []);

	return (
		<div className="app-surface flex w-full max-w-xl flex-col items-center justify-center rounded-3xl border px-8 py-14 text-center ring-1 ring-foreground/[0.025]">
			{icon && (
				<div className="mb-6 flex size-16 items-center justify-center rounded-2xl bg-primary/8 text-primary ring-1 ring-primary/15 shadow-[0_16px_35px_-24px_var(--primary)] [&_svg]:size-7">
					{icon}
				</div>
			)}
			<h3 className="mb-2 text-xl font-semibold tracking-[-0.025em]">
				{title}
			</h3>
			<p className="text-sm text-muted-foreground mb-6 max-w-md leading-relaxed">
				{description}
			</p>
			{resolvedActions.length > 0 && (
				<div className="flex flex-wrap items-center justify-center gap-2">
					{resolvedActions.map((resolvedAction) => (
						<Button
							key={resolvedAction.label}
							onClick={resolvedAction.onClick}
							variant={resolvedAction.variant}
						>
							{resolvedAction.label}
						</Button>
					))}
				</div>
			)}
		</div>
	);
}
