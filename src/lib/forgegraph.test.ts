import { describe, expect, test } from "bun:test";
import {
	getForgeGraphCredentialState,
	getForgeGraphDatabases,
	parseCachedForgeGraphServices,
} from "./forgegraph";

describe("getForgeGraphCredentialState", () => {
	test("reads configured credential secret status from ForgeGraph service config", () => {
		expect(
			getForgeGraphCredentialState({ credentialSecretConfigured: true }),
		).toEqual({
			status: "configured",
			label: "Secret",
		});

		expect(
			getForgeGraphCredentialState({ credentialSecretConfigured: false }),
		).toEqual({
			status: "missing",
			label: "No secret",
		});
	});

	test("keeps legacy ForgeGraph service responses in an unknown state", () => {
		expect(getForgeGraphCredentialState({ dbName: "legacy_app" })).toEqual({
			status: "unknown",
			label: null,
		});
	});
});

describe("parseCachedForgeGraphServices", () => {
	test("parses cached ForgeGraph service JSON fields", () => {
		const services = parseCachedForgeGraphServices([
			{
				id: 1,
				appSlug: "playtrek",
				appName: "Playtrek",
				stage: "production",
				kind: "postgres",
				nodeName: "playpath",
				nodeStatus: "online",
				config: '{"dbName":"playpath"}',
				transports: '[{"kind":"mesh","host":"100.64.0.10","port":5432}]',
				syncedAt: "2026-04-25T00:00:00Z",
			},
		]);

		expect(services).toEqual([
			{
				appSlug: "playtrek",
				appName: "Playtrek",
				stage: "production",
				kind: "postgres",
				nodeName: "playpath",
				nodeStatus: "online",
				config: { dbName: "playpath" },
				transports: [{ kind: "mesh", host: "100.64.0.10", port: 5432 }],
			},
		]);
	});

	test("keeps only ForgeGraph database services", () => {
		const databases = getForgeGraphDatabases([
			{
				appSlug: "playtrek",
				appName: "Playtrek",
				stage: "production",
				kind: "postgres",
				nodeName: "playpath",
				nodeStatus: "online",
				config: {},
				transports: [],
			},
			{
				appSlug: "playtrek",
				appName: "Playtrek",
				stage: "production",
				kind: "redis",
				nodeName: "playcache",
				nodeStatus: "online",
				config: {},
				transports: [],
			},
		]);

		expect(databases).toHaveLength(1);
		expect(databases[0].kind).toBe("postgres");
	});
});
