import { useState } from "react";
import { Eye, EyeSlash } from "@phosphor-icons/react";
import { Field, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";

interface MongoConnectionFieldsProps {
	connectionUri: string;
	onChange: (connectionUri: string) => void;
}

export function MongoConnectionFields({
	connectionUri,
	onChange,
}: MongoConnectionFieldsProps) {
	const [showUri, setShowUri] = useState(false);

	return (
		<Field>
			<FieldLabel htmlFor="connection-uri">Connection URI</FieldLabel>
			<div className="relative">
				<Input
					id="connection-uri"
					type={showUri ? "text" : "password"}
					required
					maxLength={8192}
					value={connectionUri}
					onChange={(event) => onChange(event.target.value)}
					placeholder="mongodb+srv://user:password@cluster.example.com/app"
					className="pr-10 font-mono text-xs"
				/>
				<button
					type="button"
					onClick={() => setShowUri((visible) => !visible)}
					className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
					aria-label={showUri ? "Hide connection URI" : "Show connection URI"}
				>
					{showUri ? (
						<EyeSlash className="size-3" />
					) : (
						<Eye className="size-3" />
					)}
				</button>
			</div>
		</Field>
	);
}
