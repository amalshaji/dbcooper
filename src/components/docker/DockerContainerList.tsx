import { Badge } from "@/components/ui/badge";
import type { DockerContainerSummary } from "@/types/docker";

interface DockerContainerListProps {
	containers: DockerContainerSummary[];
	onSelect: (container: DockerContainerSummary) => void;
}

export function DockerContainerList({
	containers,
	onSelect,
}: DockerContainerListProps) {
	const compatible = containers.filter((container) => container.compatible);
	if (compatible.length === 0) {
		return (
			<p className="rounded-lg border p-4 text-sm text-muted-foreground">
				No compatible PostgreSQL, Redis, or ClickHouse containers were found.
			</p>
		);
	}

	return (
		<>
			{compatible.map((container) => (
				<button
					key={container.id}
					type="button"
					onClick={() => onSelect(container)}
					className="flex w-full cursor-pointer items-center justify-between rounded-lg border p-3 text-left transition-colors hover:bg-muted"
				>
					<span className="min-w-0">
						<span className="block truncate text-sm font-medium">
							{container.name}
						</span>
						<span className="block truncate text-xs text-muted-foreground">
							{container.image}
						</span>
					</span>
					<Badge variant="secondary" className="capitalize">
						{container.state}
					</Badge>
				</button>
			))}
		</>
	);
}
