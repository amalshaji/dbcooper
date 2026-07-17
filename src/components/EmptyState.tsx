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
		<div className="workspace-panel flex w-full max-w-lg flex-col items-center justify-center rounded-xl border px-8 py-10 text-center shadow-sm">
			{icon && (
				<div className="mb-5 flex size-12 items-center justify-center rounded-lg bg-primary/10 text-primary ring-1 ring-primary/15 [&_svg]:size-5">
					{icon}
				</div>
			)}
			<h3 className="mb-1.5 text-lg font-semibold tracking-tight">{title}</h3>
			<p className="mb-5 max-w-sm text-sm leading-relaxed text-muted-foreground">
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
