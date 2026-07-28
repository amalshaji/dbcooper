import { useEffect, useState } from "react";
import { toast } from "sonner";
import { DockerConnectionFields } from "@/components/docker/DockerConnectionFields";
import { DockerContainerList } from "@/components/docker/DockerContainerList";
import { Button } from "@/components/ui/button";
import {
	Dialog,
	DialogContent,
	DialogDescription,
	DialogFooter,
	DialogHeader,
	DialogTitle,
} from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import {
	Select,
	SelectContent,
	SelectItem,
	SelectTrigger,
	SelectValue,
} from "@/components/ui/select";
import { Spinner } from "@/components/ui/spinner";
import {
	api,
	DOCKER_DATABASE_ENGINES,
	isDockerDatabaseEngine,
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

type DialogMode =
	| { status: "listing" }
	| {
			status: "choosing";
			container: DockerContainerSummary;
			engines: [DockerDatabaseEngine, DockerDatabaseEngine];
			selectedEngine: DockerDatabaseEngine;
	  }
	| {
			status: "editing";
			draft: DockerConnectionDraft;
			name: string;
	  };

export function ConnectDockerDialog({
	open,
	onOpenChange,
	onLinked,
}: ConnectDockerDialogProps) {
	const [containers, setContainers] = useState<DockerContainerSummary[]>([]);
	const [mode, setMode] = useState<DialogMode>({ status: "listing" });
	const [loading, setLoading] = useState(false);

	useEffect(() => {
		if (!open) {
			setMode({ status: "listing" });
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
			const draft = await api.docker.prepareConnection(container.id, engine);
			setMode({ status: "editing", draft, name: draft.container_name });
		} catch (error) {
			toast.error(String(error));
		} finally {
			setLoading(false);
		}
	};

	const selectContainer = async (container: DockerContainerSummary) => {
		switch (container.detection.status) {
			case "unsupported":
				return;
			case "detected":
				await prepareContainer(container, container.detection.engine);
				return;
			case "ambiguous":
				setMode({
					status: "choosing",
					container,
					engines: container.detection.engines,
					selectedEngine: container.detection.engines[0],
				});
		}
	};

	const link = async () => {
		if (mode.status !== "editing") return;
		setLoading(true);
		try {
			const connection = await api.docker.linkConnection({
				name: mode.name,
				container_id: mode.draft.container_id,
				engine: mode.draft.engine,
				host: mode.draft.host,
				port: mode.draft.port,
				database: mode.draft.database,
				username: mode.draft.username,
				password: mode.draft.password,
				connection_uri: mode.draft.connection_uri,
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
				{loading && mode.status === "listing" ? (
					<div className="flex min-h-32 items-center justify-center">
						<Spinner />
						<span className="ml-2 text-sm text-muted-foreground">
							Loading containers…
						</span>
					</div>
				) : mode.status === "editing" ? (
					<DockerConnectionFields
						draft={mode.draft}
						name={mode.name}
						onNameChange={(name) => setMode({ ...mode, name })}
						onDraftChange={(draft) => setMode({ ...mode, draft })}
					/>
				) : mode.status === "choosing" ? (
					<div className="space-y-4 rounded-lg border p-4">
						<div className="space-y-1">
							<p className="text-sm font-medium">Choose database type</p>
							<p className="text-xs text-muted-foreground">
								Port 3306 can host MySQL or MariaDB, and the image name does not
								identify which one this is.
							</p>
						</div>
						<div className="space-y-2">
							<Label htmlFor="docker-engine-choice">Database</Label>
							<Select
								value={mode.selectedEngine}
								onValueChange={(value) => {
									if (
										isDockerDatabaseEngine(value) &&
										mode.engines.includes(value)
									) {
										setMode({ ...mode, selectedEngine: value });
									}
								}}
							>
								<SelectTrigger id="docker-engine-choice" className="w-full">
									<SelectValue>{engineLabel(mode.selectedEngine)}</SelectValue>
								</SelectTrigger>
								<SelectContent>
									{mode.engines.map((engine) => (
										<SelectItem key={engine} value={engine}>
											{engineLabel(engine)}
										</SelectItem>
									))}
								</SelectContent>
							</Select>
						</div>
						<Button
							onClick={() =>
								prepareContainer(mode.container, mode.selectedEngine)
							}
						>
							{loading && <Spinner />}
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
					{mode.status !== "listing" && (
						<Button
							variant="outline"
							onClick={() => setMode({ status: "listing" })}
							disabled={loading}
						>
							Back
						</Button>
					)}
					<Button
						variant={mode.status === "editing" ? "default" : "outline"}
						onClick={
							mode.status === "editing" ? link : () => onOpenChange(false)
						}
						disabled={
							loading || (mode.status === "editing" ? !mode.name.trim() : false)
						}
					>
						{loading && mode.status === "editing" && <Spinner />}
						{mode.status === "editing" ? "Connect Docker" : "Close"}
					</Button>
				</DialogFooter>
			</DialogContent>
		</Dialog>
	);
}

function engineLabel(engine: DockerDatabaseEngine) {
	return (
		DOCKER_DATABASE_ENGINES.find((item) => item.value === engine)?.label ||
		engine
	);
}
