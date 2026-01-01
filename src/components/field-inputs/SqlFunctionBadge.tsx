import { Badge } from "@/components/ui/badge";

interface SqlFunctionBadgeProps {
	isRawSql: boolean;
}

export function SqlFunctionBadge({ isRawSql }: SqlFunctionBadgeProps) {
	if (!isRawSql) return null;

	return (
		<Badge variant="secondary" className="text-xs">
			SQL Function
		</Badge>
	);
}
