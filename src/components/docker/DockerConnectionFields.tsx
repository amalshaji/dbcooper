import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import type { DockerConnectionDraft } from "@/types/docker";

interface DockerConnectionFieldsProps {
	draft: DockerConnectionDraft;
	name: string;
	onNameChange: (name: string) => void;
	onDraftChange: (draft: DockerConnectionDraft) => void;
}

export function DockerConnectionFields({
	draft,
	name,
	onNameChange,
	onDraftChange,
}: DockerConnectionFieldsProps) {
	const textField = (field: "host" | "database" | "username" | "password") => (
		<div
			className={field === "password" ? "col-span-2 space-y-2" : "space-y-2"}
		>
			<Label htmlFor={`link-${field}`} className="capitalize">
				{field}
			</Label>
			<Input
				id={`link-${field}`}
				type={field === "password" ? "password" : "text"}
				value={draft[field]}
				onChange={(event) =>
					onDraftChange({ ...draft, [field]: event.target.value })
				}
			/>
		</div>
	);

	return (
		<div className="grid grid-cols-2 gap-3">
			<div className="col-span-2 space-y-2">
				<Label htmlFor="link-name">Connection name</Label>
				<Input
					id="link-name"
					value={name}
					maxLength={80}
					onChange={(event) => onNameChange(event.target.value)}
				/>
			</div>
			{textField("host")}
			<div className="space-y-2">
				<Label htmlFor="link-port">Port</Label>
				<Input
					id="link-port"
					inputMode="numeric"
					value={draft.port}
					onChange={(event) =>
						onDraftChange({ ...draft, port: Number(event.target.value) })
					}
				/>
			</div>
			{textField("database")}
			{textField("username")}
			{textField("password")}
			<p className="col-span-2 text-xs text-muted-foreground">
				Credentials are prefilled when the container exposes standard
				environment variables. Review them before connecting.
			</p>
		</div>
	);
}
