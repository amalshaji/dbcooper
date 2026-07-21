import { Funnel } from "@phosphor-icons/react";
import { Button } from "../ui/button";
import { SheetTrigger } from "../ui/sheet";

interface SchemaFilterTriggerProps {
	selectedCount: number;
	totalCount: number;
}

export function SchemaFilterTrigger({
	selectedCount,
	totalCount,
}: SchemaFilterTriggerProps) {
	return (
		<SheetTrigger render={<Button variant="outline" size="sm" />}>
			<Funnel className="w-4 h-4" />
			Filter ({selectedCount}/{totalCount})
		</SheetTrigger>
	);
}
