import { useEffect, useState } from "react";
import { toast } from "sonner";
import { DockerConnectionFields } from "@/components/docker/DockerConnectionFields";
import { DockerContainerList } from "@/components/docker/DockerContainerList";
import {
	Dialog,
	DialogContent,
	DialogDescription,
	DialogFooter,
	DialogHeader,
	DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Spinner } from "@/components/ui/spinner";
import {
	api,
	type Connection,
	type DockerConnectionDraft,
	type DockerContainerSummary,
} from "@/lib/tauri";

interface ConnectDockerDialogProps {
	open: boolean;
	onOpenChange: (open: boolean) => void;
	onLinked: (connection: Connection) => Promise<void>;
}

export function ConnectDockerDialog({
	open,
	onOpenChange,
	onLinked,
}: ConnectDockerDialogProps) {
	const [containers, setContainers] = useState<DockerContainerSummary[]>([]);
	const [draft, setDraft] = useState<DockerConnectionDraft | null>(null);
	const [name, setName] = useState("");
	const [loading, setLoading] = useState(false);

	useEffect(() => {
		if (!open) {
			setDraft(null);
			return;
		}
		setLoading(true);
		api.docker
			.listContainers()
			.then(setContainers)
			.catch((error) => toast.error(String(error)))
			.finally(() => setLoading(false));
	}, [open]);

	const selectContainer = async (container: DockerContainerSummary) => {
		setLoading(true);
		try {
			const next = await api.docker.prepareConnection(container.id);
			setDraft(next);
			setName(next.container_name);
		} catch (error) {
			toast.error(String(error));
		} finally {
			setLoading(false);
		}
	};

	const link = async () => {
		if (!draft) return;
		setLoading(true);
		try {
			const connection = await api.docker.linkConnection({
				name,
				container_id: draft.container_id,
				engine: draft.engine,
				host: draft.host,
				port: draft.port,
				database: draft.database,
				username: draft.username,
				password: draft.password,
			});
			await onLinked(connection);
			onOpenChange(false);
			toast.success(`Linked "${connection.name}"`);
		} catch (error) {
			toast.error(String(error));
		} finally {
			setLoading(false);
		}
	};

	return (
		<Dialog open={open} onOpenChange={onOpenChange}>
			<DialogContent className="max-w-xl">
				<DialogHeader>
					<DialogTitle>Connect Docker</DialogTitle>
					<DialogDescription>
						Choose a database container from the current Docker context.
						DBcooper inspects only the container you select.
					</DialogDescription>
				</DialogHeader>
				{loading && !draft ? (
					<div className="flex min-h-32 items-center justify-center">
						<Spinner />
						<span className="ml-2 text-sm text-muted-foreground">
							Loading containers…
						</span>
					</div>
				) : draft ? (
					<DockerConnectionFields
						draft={draft}
						name={name}
						onNameChange={setName}
						onDraftChange={setDraft}
					/>
				) : (
					<div className="max-h-72 space-y-2 overflow-auto">
						<DockerContainerList
							containers={containers}
							onSelect={selectContainer}
						/>
					</div>
				)}
				<DialogFooter>
					{draft && (
						<Button
							variant="outline"
							onClick={() => setDraft(null)}
							disabled={loading}
						>
							Back
						</Button>
					)}
					<Button
						variant={draft ? "default" : "outline"}
						onClick={draft ? link : () => onOpenChange(false)}
						disabled={loading || (draft ? !name.trim() : false)}
					>
						{loading && <Spinner />}
						{draft ? "Connect Docker" : "Close"}
					</Button>
				</DialogFooter>
			</DialogContent>
		</Dialog>
	);
}
