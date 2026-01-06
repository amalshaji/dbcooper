import {
	Dialog,
	DialogContent,
	DialogHeader,
	DialogTitle,
	DialogDescription,
} from "@/components/ui/dialog";
import { SettingsForm } from "@/components/SettingsForm";

interface SettingsDialogProps {
	open: boolean;
	onOpenChange: (open: boolean) => void;
}

export function SettingsDialog({ open, onOpenChange }: SettingsDialogProps) {
	return (
		<Dialog open={open} onOpenChange={onOpenChange}>
			<DialogContent className="max-w-lg max-h-[85vh] overflow-y-auto">
				<DialogHeader>
					<DialogTitle>Settings</DialogTitle>
					<DialogDescription>Configure your preferences</DialogDescription>
				</DialogHeader>
				<div className="py-2">
					<SettingsForm compact onSaveSuccess={() => onOpenChange(false)} />
				</div>
			</DialogContent>
		</Dialog>
	);
}
