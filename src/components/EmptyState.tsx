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
			{icon && <div className="mb-4 text-muted-foreground">{icon}</div>}
			<h3 className="text-lg font-semibold mb-2">{title}</h3>
			<p className="text-sm text-muted-foreground mb-6 max-w-md">
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
