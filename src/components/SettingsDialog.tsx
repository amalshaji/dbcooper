import { SettingsForm } from "@/components/SettingsForm";
import {
	Dialog,
	DialogContent,
	DialogDescription,
	DialogHeader,
	DialogTitle,
} from "@/components/ui/dialog";

interface SettingsDialogProps {
	open: boolean;
	onOpenChange: (open: boolean) => void;
}

export function SettingsDialog({ open, onOpenChange }: SettingsDialogProps) {
	return (
		<Dialog open={open} onOpenChange={onOpenChange}>
			<DialogContent className="max-h-[85vh] max-w-lg overflow-y-auto">
				<DialogHeader>
					<DialogTitle>Settings</DialogTitle>
					<DialogDescription>
						Appearance, updates, MCP, and contextual AI.
					</DialogDescription>
				</DialogHeader>
				<div className="py-2">
					<SettingsForm compact onSaveSuccess={() => onOpenChange(false)} />
				</div>
			</DialogContent>
		</Dialog>
	);
}
