import type { ReactNode } from "react";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Spinner } from "@/components/ui/spinner";
import { ArrowsClockwise, X } from "@phosphor-icons/react";
import { handleDragStart } from "@/lib/windowDrag";

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
		<div className="flex flex-col h-screen">
			<header
				onMouseDown={handleDragStart}
				className="flex h-12 shrink-0 items-center gap-2 border-b pl-20 pr-4 bg-background sticky top-0 z-20 select-none"
			>
				<div className="flex items-center gap-2 flex-1 ml-4">
					<Button variant="ghost" size="sm" onClick={onClose} className="gap-2">
						<X className="w-4 h-4" />
						Close Connection
					</Button>
					<span className="font-semibold">{connectionName}</span>
				</div>
			</header>
			<div className="flex-1 flex items-center justify-center bg-background">
				<div className="flex flex-col items-center gap-5 max-w-md px-6 text-center">
					<div className="shrink-0 opacity-50">{databaseIcon}</div>
					<div className="flex flex-col gap-2">
						<h2 className="text-lg font-semibold">Connection failed</h2>
						<p className="text-sm text-muted-foreground">
							Couldn't connect to {connectionName}.
						</p>
						{error && (
							<p className="text-sm text-red-500 break-words">{error}</p>
						)}
					</div>
					<div className="flex items-center gap-2">
						<Button
							onClick={handleRetry}
							disabled={isReconnecting}
							className="gap-2"
						>
							{isReconnecting ? (
								<Spinner className="w-4 h-4" />
							) : (
								<ArrowsClockwise className="w-4 h-4" />
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
