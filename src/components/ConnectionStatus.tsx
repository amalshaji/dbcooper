import { useState, useEffect, useCallback, useRef } from "react";
import { api } from "@/lib/tauri";
import { Spinner } from "@/components/ui/spinner";
import { Button } from "@/components/ui/button";
import {
	Tooltip,
	TooltipContent,
	TooltipTrigger,
} from "@/components/ui/tooltip";
import { ArrowsClockwise } from "@phosphor-icons/react";

type Status = "connected" | "disconnected" | "reconnecting";

interface ConnectionStatusProps {
	connectionUuid: string;
	initialStatus?: "connected" | "disconnected";
	onReconnect?: () => Promise<void>;
}

export function ConnectionStatus({
	connectionUuid,
	initialStatus = "connected",
	onReconnect,
}: ConnectionStatusProps) {
	const [isReconnecting, setIsReconnecting] = useState(false);
	const [error, setError] = useState<string | null>(null);
	const isMounted = useRef(true);

	const status: Status = isReconnecting ? "reconnecting" : initialStatus;

	const reconnect = useCallback(async () => {
		if (!isMounted.current) return;

		setIsReconnecting(true);

		try {
			if (onReconnect) {
				await onReconnect();
			} else {
				await api.pool.connect(connectionUuid);
			}
		} catch (err) {
			if (isMounted.current) {
				setError(err instanceof Error ? err.message : "Connection failed");
			}
		} finally {
			if (isMounted.current) {
				setIsReconnecting(false);
			}
		}
	}, [connectionUuid, onReconnect]);

	useEffect(() => {
		isMounted.current = true;
		return () => {
			isMounted.current = false;
		};
	}, []);

	useEffect(() => {
		if (status !== "connected") return;

		const interval = setInterval(() => {
			if (isMounted.current) {
				api.pool.healthCheck(connectionUuid).catch(() => {});
			}
		}, 30000);

		return () => clearInterval(interval);
	}, [connectionUuid, status]);

	const statusColors = {
		connected: "bg-green-500",
		disconnected: "bg-red-500",
		reconnecting: "bg-yellow-500",
	};

	const statusLabels = {
		connected: "Connected",
		disconnected: "Disconnected",
		reconnecting: "Reconnecting",
	};

	return (
		<div className="flex items-center gap-2">
			<Tooltip>
				<TooltipTrigger
					render={
						<div className="flex items-center gap-1.5 cursor-default">
							{isReconnecting ? (
								<Spinner className="w-3 h-3" />
							) : (
								<span
									className={`w-2 h-2 rounded-full ${statusColors[status]}`}
								/>
							)}
							<span className="text-xs text-muted-foreground">
								{statusLabels[status]}
							</span>
						</div>
					}
				/>
				<TooltipContent>
					<p>
						Status: {statusLabels[status]}
						{error && <span className="block text-red-400">{error}</span>}
					</p>
				</TooltipContent>
			</Tooltip>

			{status === "disconnected" && (
				<Button
					variant="ghost"
					size="icon-sm"
					onClick={reconnect}
					disabled={isReconnecting}
					title="Reconnect"
				>
					<ArrowsClockwise
						className={`w-3.5 h-3.5 ${isReconnecting ? "animate-spin" : ""}`}
					/>
				</Button>
			)}
		</div>
	);
}
