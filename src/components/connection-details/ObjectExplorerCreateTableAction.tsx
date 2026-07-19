import { Plus } from "@phosphor-icons/react";
import { Button } from "@/components/ui/button";

interface ObjectExplorerCreateTableActionProps {
	visible: boolean;
	onCreateTable: () => void;
}

export function ObjectExplorerCreateTableAction({
	visible,
	onCreateTable,
}: ObjectExplorerCreateTableActionProps) {
	if (!visible) return null;

	return (
		<Button
			type="button"
			variant="outline"
			size="sm"
			className="w-full justify-start"
			onClick={onCreateTable}
		>
			<Plus />
			Create table
		</Button>
	);
}
