import {
	createContext,
	useCallback,
	useContext,
	useMemo,
	useState,
	type ReactNode,
} from "react";
import type { Connection } from "@/lib/tauri";

type ConnectionStatus = "connected" | "disconnected";

interface ActiveConnectionsContextValue {
	activeIds: string[];
	activeId: string | null;
	connectionsById: Record<string, Connection>;
	statusById: Record<string, ConnectionStatus>;
	addActive: (uuid: string) => void;
	setActive: (uuid: string | null) => void;
	removeActive: (uuid: string) => void;
	cacheConnection: (connection: Connection) => void;
	setStatus: (uuid: string, status: ConnectionStatus) => void;
}

const ActiveConnectionsContext = createContext<ActiveConnectionsContextValue | null>(null);

export function useActiveConnections() {
	const context = useContext(ActiveConnectionsContext);
	if (!context) {
		throw new Error("useActiveConnections must be used within ActiveConnectionsProvider.");
	}
	return context;
}

export function ActiveConnectionsProvider({ children }: { children: ReactNode }) {
	const [activeIds, setActiveIds] = useState<string[]>([]);
	const [activeId, setActiveId] = useState<string | null>(null);
	const [connectionsById, setConnectionsById] = useState<Record<string, Connection>>({});
	const [statusById, setStatusById] = useState<Record<string, ConnectionStatus>>({});

	const addActive = useCallback((uuid: string) => {
		setActiveIds((prev) => (prev.includes(uuid) ? prev : [...prev, uuid]));
	}, []);

	const setActive = useCallback((uuid: string | null) => {
		setActiveId(uuid);
	}, []);

	const removeActive = useCallback((uuid: string) => {
		setActiveIds((prev) => {
			const next = prev.filter((id) => id !== uuid);
			setActiveId((current) =>
				current === uuid ? (next[0] ?? null) : current,
			);
			return next;
		});
		setConnectionsById((prev) => {
			const next = { ...prev };
			delete next[uuid];
			return next;
		});
		setStatusById((prev) => {
			const next = { ...prev };
			delete next[uuid];
			return next;
		});
	}, []);

	const cacheConnection = useCallback((connection: Connection) => {
		setConnectionsById((prev) => ({ ...prev, [connection.uuid]: connection }));
	}, []);

	const setStatus = useCallback((uuid: string, status: ConnectionStatus) => {
		setStatusById((prev) => ({ ...prev, [uuid]: status }));
	}, []);

	const value = useMemo(
		() => ({
			activeIds,
			activeId,
			connectionsById,
			statusById,
			addActive,
			setActive,
			removeActive,
			cacheConnection,
			setStatus,
		}),
		[
			activeIds,
			activeId,
			connectionsById,
			statusById,
			addActive,
			setActive,
			removeActive,
			cacheConnection,
			setStatus,
		],
	);

	return (
		<ActiveConnectionsContext.Provider value={value}>
			{children}
		</ActiveConnectionsContext.Provider>
	);
}
