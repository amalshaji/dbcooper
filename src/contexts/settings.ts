import { createContext, useContext } from "react";

interface SettingsContextValue {
	openSettings: () => void;
}

export const SettingsContext = createContext<SettingsContextValue | null>(null);

export function useSettings() {
	const context = useContext(SettingsContext);
	if (!context) {
		throw new Error("useSettings must be used within a SettingsProvider");
	}
	return context;
}
