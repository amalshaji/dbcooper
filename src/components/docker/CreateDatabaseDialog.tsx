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
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Spinner } from "@/components/ui/spinner";
import {
	api,
	type Connection,
	type DockerDatabaseEngine,
} from "@/lib/tauri";

interface CreateDatabaseDialogProps {
	open: boolean;
	onOpenChange: (open: boolean) => void;
	onCreated: (connection: Connection) => Promise<void>;
}

export function CreateDatabaseDialog({
	open,
	onOpenChange,
	onCreated,
}: CreateDatabaseDialogProps) {
	const [engine, setEngine] = useState<DockerDatabaseEngine>("postgres");
	const [name, setName] = useState("Local PostgreSQL");
	const [creating, setCreating] = useState(false);

	useEffect(() => {
		if (!open) return;
		const labels: Record<DockerDatabaseEngine, string> = {
			postgres: "Local PostgreSQL",
			redis: "Local Redis",
			clickhouse: "Local ClickHouse",
		};
		setName(labels[engine]);
	}, [engine, open]);

	const create = async () => {
		setCreating(true);
		try {
			const connection = await api.docker.createDatabase(engine, name);
			await onCreated(connection);
			onOpenChange(false);
			toast.success(`Created "${connection.name}"`, {
				action: {
					label: "Copy connection string",
					onClick: async () => {
						const value = await api.docker.connectionString(connection.uuid);
						await navigator.clipboard.writeText(value);
						toast.success("Connection string copied");
					},
				},
			});
		} catch (error) {
			toast.error(String(error));
		} finally {
			setCreating(false);
		}
	};

	return (
		<Dialog open={open} onOpenChange={onOpenChange}>
			<DialogContent>
				<DialogHeader>
					<DialogTitle>Create database</DialogTitle>
					<DialogDescription>
						DBcooper creates a persistent Docker container and volume, then
						saves a connection to it.
					</DialogDescription>
				</DialogHeader>
				<div className="space-y-4">
					<div className="space-y-2">
						<Label htmlFor="docker-engine">Database</Label>
						<select
							id="docker-engine"
							value={engine}
							onChange={(event) =>
								setEngine(event.target.value as DockerDatabaseEngine)
							}
							className="h-8 w-full rounded-lg border border-input bg-transparent px-2.5 text-xs outline-none focus-visible:border-ring focus-visible:ring-1 focus-visible:ring-ring/50"
						>
							<option value="postgres">PostgreSQL 17</option>
							<option value="redis">Redis 7</option>
							<option value="clickhouse">ClickHouse 25.8</option>
						</select>
					</div>
					<div className="space-y-2">
						<Label htmlFor="docker-name">Connection name</Label>
						<Input
							id="docker-name"
							value={name}
							maxLength={80}
							onChange={(event) => setName(event.target.value)}
						/>
					</div>
					<p className="text-xs text-muted-foreground">
						Quitting DBcooper stops this container. Your database and volume
						remain, and the container starts again when you open the connection.
					</p>
				</div>
				<DialogFooter>
					<Button
						variant="outline"
						onClick={() => onOpenChange(false)}
						disabled={creating}
					>
						Cancel
					</Button>
					<Button onClick={create} disabled={creating || !name.trim()}>
						{creating && <Spinner />}
						Create database
					</Button>
				</DialogFooter>
			</DialogContent>
		</Dialog>
	);
}
