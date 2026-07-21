import {
	AlertDialog,
	AlertDialogAction,
	AlertDialogCancel,
	AlertDialogContent,
	AlertDialogDescription,
	AlertDialogFooter,
	AlertDialogHeader,
	AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Spinner } from "@/components/ui/spinner";

interface McpTokenDialogProps {
	open: boolean;
	busy: boolean;
	onOpenChange: (open: boolean) => void;
	onRegenerate: () => void;
}

export function McpTokenDialog({
	open,
	busy,
	onOpenChange,
	onRegenerate,
}: McpTokenDialogProps) {
	return (
		<AlertDialog open={open} onOpenChange={onOpenChange}>
			<AlertDialogContent>
				<AlertDialogHeader>
					<AlertDialogTitle>Replace the MCP token?</AlertDialogTitle>
					<AlertDialogDescription>
						Existing MCP clients will stop working until you copy the new token
						into their configuration.
					</AlertDialogDescription>
				</AlertDialogHeader>
				<AlertDialogFooter>
					<AlertDialogCancel disabled={busy}>Cancel</AlertDialogCancel>
					<AlertDialogAction onClick={onRegenerate} disabled={busy}>
						{busy && <Spinner />}
						Regenerate now
					</AlertDialogAction>
				</AlertDialogFooter>
			</AlertDialogContent>
		</AlertDialog>
	);
}
