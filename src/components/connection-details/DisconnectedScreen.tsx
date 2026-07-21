import { ArrowsClockwise, X } from "@phosphor-icons/react";
import type { ReactNode } from "react";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Spinner } from "@/components/ui/spinner";

interface DisconnectedScreenProps {
	connectionName: string;
	databaseIcon: ReactNode;
	error: string | null;
	onReconnect: () => Promise<void>;
	onClose: () => void;
}

/**
 * Full-screen takeover shown when the initial connect fails, instead of the
 * empty workspace shell. Owns its own retry-in-flight state.
 */
export function DisconnectedScreen({
	connectionName,
	databaseIcon,
	error,
	onReconnect,
	onClose,
}: DisconnectedScreenProps) {
	const [isReconnecting, setIsReconnecting] = useState(false);

	const handleRetry = async () => {
		setIsReconnecting(true);
		try {
			await onReconnect();
		} catch {
			// failure already surfaced upstream via toast + the error prop
		} finally {
			setIsReconnecting(false);
		}
	};

	return (
		<div className="workspace-canvas flex h-screen flex-col">
			<header
				data-tauri-drag-region
				className="app-titlebar sticky top-0 z-20 flex h-12 shrink-0 select-none items-center border-b pl-20 pr-4"
			>
				<div className="ml-4 flex flex-1 items-center gap-2">
					<Button variant="ghost" size="sm" onClick={onClose}>
						<X className="size-4" />
						Close connection
					</Button>
					<span className="text-sm font-semibold">{connectionName}</span>
				</div>
			</header>
			<div className="flex flex-1 items-center justify-center p-6">
				<div className="workspace-panel flex w-full max-w-md flex-col items-center rounded-xl border px-7 py-8 text-center shadow-sm">
					<div className="mb-5 shrink-0 opacity-60">{databaseIcon}</div>
					<div>
						<h2 className="text-lg font-semibold">Connection failed</h2>
						<p className="mt-1 text-sm text-muted-foreground">
							Couldn't connect to {connectionName}.
						</p>
						{error && (
							<p className="mt-3 break-words rounded-md border border-destructive/20 bg-destructive/5 px-3 py-2 text-left font-mono text-xs text-destructive">
								{error}
							</p>
						)}
					</div>
					<div className="mt-5 flex items-center gap-2">
						<Button onClick={handleRetry} disabled={isReconnecting}>
							{isReconnecting ? (
								<Spinner className="size-4" />
							) : (
								<ArrowsClockwise className="size-4" />
							)}
							Retry connection
						</Button>
						<Button variant="ghost" onClick={onClose}>
							Close
						</Button>
					</div>
				</div>
			</div>
		</div>
	);
}
