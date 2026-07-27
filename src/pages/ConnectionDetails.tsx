import { useNavigate, useParams } from "react-router-dom";
import { RedisConnectionHeader } from "@/components/connection-details/ConnectionHeaders";
import {
	ConnectionOpeningScreen,
	DatabaseIcon,
} from "@/components/connection-details/ConnectionOpeningScreen";
import { DisconnectedScreen } from "@/components/connection-details/DisconnectedScreen";
import { RedisWorkspace } from "@/components/connection-details/RedisWorkspace";
import { SqlConnectionWorkspace } from "@/components/connection-details/SqlConnectionWorkspace";
import { useSettings } from "@/contexts/SettingsContext";
import { useConnectionLifecycle } from "@/hooks/connection-details/useConnectionLifecycle";
import { isSqlConnection } from "@/types/connection";

export function ConnectionDetails() {
	const { uuid } = useParams<{ uuid: string }>();
	const navigate = useNavigate();
	const { openSettings } = useSettings();
	const lifecycle = useConnectionLifecycle({ uuid, navigate });
	const connection = lifecycle.connection.value;
	const closeConnection = () => navigate("/");

	if (lifecycle.opening.phase !== "complete" || connection === null) {
		return (
			<ConnectionOpeningScreen
				connection={connection}
				loadingPhase={lifecycle.opening.phase}
				connectionStatus={lifecycle.connection.status}
				duckDbHelperProgress={lifecycle.opening.duckDbHelperProgress}
			/>
		);
	}

	if (
		lifecycle.connection.status === "disconnected" &&
		!lifecycle.connection.hasEverConnected
	) {
		return (
			<DisconnectedScreen
				connectionName={connection.name}
				databaseIcon={<DatabaseIcon connection={connection} />}
				error={lifecycle.connection.error}
				onReconnect={lifecycle.commands.reconnect}
				onClose={closeConnection}
			/>
		);
	}

	if (isSqlConnection(connection)) {
		return (
			<SqlConnectionWorkspace
				connection={connection}
				lifecycle={lifecycle}
				onClose={closeConnection}
			/>
		);
	}

	return (
		<div className="workspace-canvas flex h-screen flex-col">
			<RedisConnectionHeader
				connection={connection}
				onClose={closeConnection}
				connectionStatus={lifecycle.connection.status}
				onReconnect={lifecycle.commands.reconnect}
				onStatusChange={lifecycle.commands.recordConnectionStatus}
				onOpenSettings={openSettings}
			/>
			<div className="min-w-0 flex-1 overflow-auto p-3">
				<RedisWorkspace connection={connection} />
			</div>
		</div>
	);
}
