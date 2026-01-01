import { Button } from "@/components/ui/button";
import { generateUUIDv4 } from "@/lib/columnUtils";

interface UuidButtonProps {
	onGenerate: (uuid: string) => void;
}

export function UuidButton({ onGenerate }: UuidButtonProps) {
	return (
		<Button
			variant="ghost"
			size="sm"
			className="h-6 text-xs"
			onClick={() => onGenerate(generateUUIDv4())}
		>
			Generate UUID
		</Button>
	);
}
