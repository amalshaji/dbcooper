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
		<div className="flex flex-col items-center justify-center py-12 px-4 text-center">
			{icon && (
				<div className="mb-5 flex size-16 items-center justify-center rounded-2xl bg-gradient-to-b from-muted/70 to-muted/20 text-muted-foreground/80 ring-1 ring-border shadow-sm [&_svg]:size-7">
					{icon}
				</div>
			)}
			<h3 className="text-lg font-semibold tracking-tight mb-2">{title}</h3>
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
