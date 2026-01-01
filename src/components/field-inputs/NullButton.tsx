import { Button } from "@/components/ui/button";

interface NullButtonProps {
	isNull: boolean;
	nullable: boolean;
	onToggle: () => void;
	setValueLabel?: string;
}

export function NullButton({
	isNull,
	nullable,
	onToggle,
	setValueLabel = "Set value",
}: NullButtonProps) {
	if (!nullable) return null;

	return (
		<Button
			variant="ghost"
			size="sm"
			className="h-6 text-xs"
			onClick={onToggle}
		>
			{isNull ? setValueLabel : "Set NULL"}
		</Button>
	);
}
