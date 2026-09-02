import { useNavigate, useParams } from "react-router-dom";
import { ConnectionWorkspaceHeader } from "@/components/connection-details/ConnectionHeaders";
import {
	ConnectionOpeningScreen,
	DatabaseIcon,
} from "@/components/connection-details/ConnectionOpeningScreen";
import { DisconnectedScreen } from "@/components/connection-details/DisconnectedScreen";
import { RedisWorkspace } from "@/components/connection-details/RedisWorkspace";
import { SqlConnectionWorkspace } from "@/components/connection-details/SqlConnectionWorkspace";
import { MongoConnectionWorkspace } from "@/components/connection-details/MongoConnectionWorkspace";
import { WorkspaceLogsNavigation } from "@/components/logs/WorkspaceLogsNavigation";
import { useSettings } from "@/contexts/SettingsContext";
import { useConnectionLifecycle } from "@/hooks/connection-details/useConnectionLifecycle";
import { useNativeCloseListener } from "@/hooks/connection-details/useNativeCloseListener";
import { isMongoConnection, isSqlConnection } from "@/types/connection";

export function ConnectionDetails() {
	const { uuid } = useParams<{ uuid: string }>();
	const navigate = useNavigate();
	const { openSettings } = useSettings();
	const lifecycle = useConnectionLifecycle({ uuid, navigate });
	const connection = lifecycle.connection.value;
	const closeConnection = () => navigate("/");
	const ready = lifecycle.opening.phase === "complete" && connection !== null;
	const initiallyDisconnected =
		ready &&
		lifecycle.connection.status === "disconnected" &&
		!lifecycle.connection.hasEverConnected;
	useNativeCloseListener(
		{ kind: "window" },
		!ready || Boolean(initiallyDisconnected),
	);

	if (!ready) {
		return (
			<ConnectionOpeningScreen
				connection={connection}
				loadingPhase={lifecycle.opening.phase}
				connectionStatus={lifecycle.connection.status}
				duckDbHelperProgress={lifecycle.opening.duckDbHelperProgress}
			/>
		);
	}

	if (initiallyDisconnected) {
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

	if (isMongoConnection(connection)) {
		return (
			<MongoConnectionWorkspace
				connection={connection}
				lifecycle={lifecycle}
				onClose={closeConnection}
				onOpenSettings={openSettings}
			/>
		);
	}

	return (
		<div className="workspace-canvas flex h-screen flex-col">
			<ConnectionWorkspaceHeader
				connection={connection}
				onClose={closeConnection}
				connectionStatus={lifecycle.connection.status}
				onReconnect={lifecycle.commands.reconnect}
				onStatusChange={lifecycle.commands.recordConnectionStatus}
				onOpenSettings={openSettings}
			/>
			<WorkspaceLogsNavigation
				connection={connection}
				workspaceLabel="Keys"
				workspaceCloseTarget={{ kind: "window" }}
			>
				<div className="h-full min-w-0 overflow-auto p-3">
					<RedisWorkspace connection={connection} />
				</div>
			</WorkspaceLogsNavigation>
		</div>
	);
}
