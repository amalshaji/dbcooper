export async function loadSettingsFormData<TSettings, THarness>(
	loadSettings: () => Promise<TSettings>,
	detectHarnesses: () => Promise<THarness[]>,
): Promise<{ settings: TSettings; harnesses: THarness[] }> {
	const [settingsResult, harnessesResult] = await Promise.allSettled([
		loadSettings(),
		detectHarnesses(),
	]);

	if (settingsResult.status === "rejected") {
		throw settingsResult.reason;
	}

	return {
		settings: settingsResult.value,
		harnesses:
			harnessesResult.status === "fulfilled" ? harnessesResult.value : [],
	};
}
