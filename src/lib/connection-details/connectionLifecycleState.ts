export type LoadingPhase =
	| "fetching-config"
	| "preparing-duckdb"
	| "establishing-ssh"
	| "connecting"
	| "loading-schema"
	| "complete";

export type ConnectionStatus = "connected" | "disconnected";
