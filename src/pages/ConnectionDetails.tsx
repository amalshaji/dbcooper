import { useEffect } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { ActiveConnectionsSidebar } from "@/components/ActiveConnectionsSidebar";
import { ConnectionWorkspacePane } from "@/components/connection/ConnectionWorkspacePane";
import { useActiveConnections } from "@/contexts/ActiveConnectionsContext";

export function ConnectionDetails() {
	const { uuid } = useParams();
	const navigate = useNavigate();
	const { activeIds, activeId, addActive, setActive } = useActiveConnections();

	useEffect(() => {
		if (!uuid) {
			navigate("/");
			return;
		}
		addActive(uuid);
		setActive(uuid);
	}, [uuid, addActive, setActive, navigate]);

	if (!uuid) return null;

	const currentActiveId = activeId || uuid;
	const paneIds = activeIds.length > 0 ? activeIds : [uuid];

	return (
		<div className="flex h-screen w-full">
			<ActiveConnectionsSidebar />
			<div className="flex-1 min-w-0 relative">
				{paneIds.map((id) => {
					const isCurrent = id === currentActiveId;
					return (
						<div
							key={id}
							className={`absolute inset-0 ${isCurrent ? "opacity-100" : "opacity-0 pointer-events-none"}`}
						>
							<ConnectionWorkspacePane
								connectionUuid={id}
								isActive={isCurrent}
							/>
						</div>
					);
				})}
			</div>
		</div>
	);
}
