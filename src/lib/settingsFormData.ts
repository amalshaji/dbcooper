export function loadSettingsFormData<TSettings, THarness>(
	loadSettings: () => Promise<TSettings>,
	detectHarnesses: () => Promise<THarness[]>,
): { settings: Promise<TSettings>; harnesses: Promise<THarness[]> } {
	return {
		settings: loadSettings(),
		harnesses: detectHarnesses().catch(() => []),
	};
}
