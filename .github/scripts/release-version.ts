const stableVersionPattern = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/;

type ReleaseVersionMode = "patch" | "minor" | "major" | "explicit";

function parseStableVersion(version: string): [number, number, number] {
	const match = stableVersionPattern.exec(version);
	if (!match) {
		throw new Error(`Invalid stable version: ${version}`);
	}

	return [Number(match[1]), Number(match[2]), Number(match[3])];
}

export function resolveReleaseVersion(
	currentVersion: string,
	mode: ReleaseVersionMode,
	explicitVersion = "",
): string {
	const current = parseStableVersion(currentVersion);

	if (mode === "explicit") {
		const explicit = parseStableVersion(explicitVersion);
		for (let index = 0; index < current.length; index += 1) {
			if (explicit[index] > current[index]) return explicitVersion;
			if (explicit[index] < current[index]) break;
		}

		throw new Error(
			`Explicit version ${explicitVersion} must be newer than ${currentVersion}`,
		);
	}

	const [major, minor, patch] = current;
	switch (mode) {
		case "patch":
			return `${major}.${minor}.${patch + 1}`;
		case "minor":
			return `${major}.${minor + 1}.0`;
		case "major":
			return `${major + 1}.0.0`;
		default:
			throw new Error(`Unsupported release version mode: ${mode}`);
	}
}

async function updateReleaseVersion(mode: string, explicitVersion: string) {
	if (!["patch", "minor", "major", "explicit"].includes(mode)) {
		throw new Error(`Unsupported release version mode: ${mode}`);
	}

	const configPath = "./src-tauri/tauri.conf.json";
	const config = await Bun.file(configPath).json();
	const version = resolveReleaseVersion(
		config.version,
		mode as ReleaseVersionMode,
		explicitVersion,
	);
	config.version = version;
	await Bun.write(configPath, `${JSON.stringify(config, null, 2)}\n`);
	return version;
}

if (import.meta.main) {
	try {
		console.log(await updateReleaseVersion(Bun.argv[2] ?? "", Bun.argv[3] ?? ""));
	} catch (error) {
		console.error(error instanceof Error ? error.message : error);
		process.exit(1);
	}
}
