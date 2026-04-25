import type { CachedForgeGraphService, ForgeGraphService } from "@/lib/tauri";

export type ForgeGraphCredentialState =
	| { status: "configured"; label: "Secret" }
	| { status: "missing"; label: "No secret" }
	| { status: "unknown"; label: null };

function parseJsonOrDefault<T>(value: string | null, fallback: T): T {
	if (!value) return fallback;

	try {
		return JSON.parse(value) as T;
	} catch {
		return fallback;
	}
}

export function getForgeGraphCredentialState(
	config: Record<string, unknown>,
): ForgeGraphCredentialState {
	const configured = config.credentialSecretConfigured;
	if (configured === true) {
		return { status: "configured", label: "Secret" };
	}
	if (configured === false) {
		return { status: "missing", label: "No secret" };
	}
	return { status: "unknown", label: null };
}

export function parseCachedForgeGraphServices(
	cached: CachedForgeGraphService[],
): ForgeGraphService[] {
	return cached.map((c) => ({
		appSlug: c.appSlug,
		appName: c.appName,
		stage: c.stage,
		kind: c.kind as "postgres" | "redis",
		nodeName: c.nodeName,
		nodeStatus: c.nodeStatus as "online" | "degraded" | "offline",
		config: parseJsonOrDefault(c.config, {}),
		transports: parseJsonOrDefault(c.transports, []),
	}));
}

export function getForgeGraphDatabases(
	services: ForgeGraphService[],
): ForgeGraphService[] {
	return services.filter((service) => service.kind === "postgres");
}
