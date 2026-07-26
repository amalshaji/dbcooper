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
import { Label } from "@/components/ui/label";
import {
	Select,
	SelectContent,
	SelectItem,
	SelectTrigger,
	SelectValue,
} from "@/components/ui/select";
import {
	api,
	DOCKER_DATABASE_ENGINES,
	type Connection,
	type DockerConnectionDraft,
	type DockerContainerSummary,
	type DockerDatabaseEngine,
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
	const [pendingContainer, setPendingContainer] =
		useState<DockerContainerSummary | null>(null);
	const [selectedEngine, setSelectedEngine] =
		useState<DockerDatabaseEngine>("mysql");
	const [loading, setLoading] = useState(false);

	useEffect(() => {
		if (!open) {
			setDraft(null);
			setPendingContainer(null);
			return;
		}
		setLoading(true);
		api.docker
			.listContainers()
			.then(setContainers)
			.catch((error) => toast.error(String(error)))
			.finally(() => setLoading(false));
	}, [open]);

	const prepareContainer = async (
		container: DockerContainerSummary,
		engine?: DockerDatabaseEngine,
	) => {
		setLoading(true);
		try {
			const next = await api.docker.prepareConnection(container.id, engine);
			setDraft(next);
			setPendingContainer(null);
			setName(next.container_name);
		} catch (error) {
			toast.error(String(error));
		} finally {
			setLoading(false);
		}
	};

	const selectContainer = async (container: DockerContainerSummary) => {
		if (!container.engine && container.possible_engines.length > 1) {
			setPendingContainer(container);
			setSelectedEngine(container.possible_engines[0]);
			return;
		}
		await prepareContainer(container, container.engine || undefined);
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
				) : pendingContainer ? (
					<div className="space-y-4 rounded-lg border p-4">
						<div className="space-y-1">
							<p className="text-sm font-medium">Choose database type</p>
							<p className="text-xs text-muted-foreground">
								Port 3306 can host MySQL or MariaDB, and the image name does not identify which one this is.
							</p>
						</div>
						<div className="space-y-2">
							<Label htmlFor="docker-engine-choice">Database</Label>
							<Select
								value={selectedEngine}
								onValueChange={(value) => setSelectedEngine(value as DockerDatabaseEngine)}
							>
								<SelectTrigger id="docker-engine-choice" className="w-full">
									<SelectValue>
										{DOCKER_DATABASE_ENGINES.find(
											(item) => item.value === selectedEngine,
										)?.label || selectedEngine}
									</SelectValue>
								</SelectTrigger>
								<SelectContent>
									{pendingContainer.possible_engines.map((engine) => {
										const option = DOCKER_DATABASE_ENGINES.find((item) => item.value === engine);
										return <SelectItem key={engine} value={engine}>{option?.label || engine}</SelectItem>;
									})}
								</SelectContent>
							</Select>
						</div>
						<Button onClick={() => prepareContainer(pendingContainer, selectedEngine)}>
							Continue
						</Button>
					</div>
				) : (
					<div className="max-h-72 space-y-2 overflow-auto">
						<DockerContainerList
							containers={containers}
							onSelect={selectContainer}
						/>
					</div>
				)}
				<DialogFooter>
					{(draft || pendingContainer) && (
						<Button
							variant="outline"
							onClick={() => {
								setDraft(null);
								setPendingContainer(null);
							}}
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
