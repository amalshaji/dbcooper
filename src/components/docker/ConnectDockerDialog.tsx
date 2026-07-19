import { useEffect, useState } from "react";
import { toast } from "sonner";
import {
	Dialog,
	DialogContent,
	DialogDescription,
	DialogFooter,
	DialogHeader,
	DialogTitle,
} from "@/components/ui/dialog";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
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

	const updateDraft = (field: keyof DockerConnectionDraft, value: string) => {
		if (!draft) return;
		setDraft({
			...draft,
			[field]: field === "port" ? Number(value) : value,
		});
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
					<div className="grid grid-cols-2 gap-3">
						<div className="col-span-2 space-y-2">
							<Label htmlFor="link-name">Connection name</Label>
							<Input
								id="link-name"
								value={name}
								onChange={(event) => setName(event.target.value)}
							/>
						</div>
						{(["host", "port", "database", "username", "password"] as const).map(
							(field) => (
								<div
									key={field}
									className={
										field === "password" ? "col-span-2 space-y-2" : "space-y-2"
									}
								>
									<Label htmlFor={`link-${field}`} className="capitalize">
										{field}
									</Label>
									<Input
										id={`link-${field}`}
										type={field === "password" ? "password" : "text"}
										value={draft[field]}
										onChange={(event) => updateDraft(field, event.target.value)}
									/>
								</div>
							),
						)}
						<p className="col-span-2 text-xs text-muted-foreground">
							Credentials are prefilled when the container exposes standard
							environment variables. Review them before connecting.
						</p>
					</div>
				) : (
					<div className="max-h-72 space-y-2 overflow-auto">
						{containers.filter((container) => container.compatible).length ===
						0 ? (
							<p className="rounded-lg border p-4 text-sm text-muted-foreground">
								No compatible PostgreSQL, Redis, or ClickHouse containers
								were found.
							</p>
						) : (
							containers
								.filter((container) => container.compatible)
								.map((container) => (
									<button
										key={container.id}
										type="button"
										onClick={() => selectContainer(container)}
										className="flex w-full cursor-pointer items-center justify-between rounded-lg border p-3 text-left transition-colors hover:bg-muted"
									>
										<span className="min-w-0">
											<span className="block truncate text-sm font-medium">
												{container.name}
											</span>
											<span className="block truncate text-xs text-muted-foreground">
												{container.image}
											</span>
										</span>
										<Badge variant="secondary" className="capitalize">
											{container.state}
										</Badge>
									</button>
								))
						)}
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
						onClick={
							draft ? link : () => onOpenChange(false)
						}
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
