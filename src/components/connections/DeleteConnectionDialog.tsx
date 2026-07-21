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
import { Checkbox } from "@/components/ui/checkbox";
import { Spinner } from "@/components/ui/spinner";
import type { Connection } from "@/lib/tauri";
import type { DockerConnectionState } from "@/types/docker";

interface DeleteConnectionDialogProps {
	connection: Connection | null;
	dockerState?: DockerConnectionState;
	deleteDockerData: boolean;
	deleting: boolean;
	onDeleteDockerDataChange: (checked: boolean) => void;
	onCancel: () => void;
	onConfirm: () => void;
}

export function DeleteConnectionDialog({
	connection,
	dockerState,
	deleteDockerData,
	deleting,
	onDeleteDockerDataChange,
	onCancel,
	onConfirm,
}: DeleteConnectionDialogProps) {
	return (
		<AlertDialog
			open={connection !== null}
			onOpenChange={(open) => !open && onCancel()}
		>
			<AlertDialogContent>
				<AlertDialogHeader>
					<AlertDialogTitle>Delete connection</AlertDialogTitle>
					<AlertDialogDescription>
						Are you sure you want to delete "{connection?.name}"?
						{dockerState &&
							" The Docker container and its data are preserved by default."}
					</AlertDialogDescription>
				</AlertDialogHeader>
				{dockerState && (
					<label className="flex cursor-pointer items-start gap-3 rounded-lg border p-3 text-sm">
						<Checkbox
							className="mt-0.5"
							checked={deleteDockerData}
							onCheckedChange={(checked) =>
								onDeleteDockerDataChange(checked === true)
							}
							aria-label="Also delete Docker resources"
						/>
						<span>
							{dockerState.ownership === "created"
								? "Also delete the Docker container and its data volume"
								: "Also delete the Docker container and its anonymous volumes"}
							<span className="mt-1 block text-xs text-muted-foreground">
								Named volumes and bind mounts on linked containers are always
								preserved.
							</span>
						</span>
					</label>
				)}
				<AlertDialogFooter>
					<AlertDialogCancel disabled={deleting}>Cancel</AlertDialogCancel>
					<AlertDialogAction
						onClick={onConfirm}
						disabled={deleting}
						variant="destructive"
					>
						{deleting && <Spinner />}
						Delete
					</AlertDialogAction>
				</AlertDialogFooter>
			</AlertDialogContent>
		</AlertDialog>
	);
}
