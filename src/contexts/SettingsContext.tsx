import { createContext, useContext, useState, type ReactNode } from "react";
import { SettingsDialog } from "@/components/SettingsDialog";

interface SettingsContextValue {
	openSettings: () => void;
}

const SettingsContext = createContext<SettingsContextValue | null>(null);

export function useSettings() {
	const context = useContext(SettingsContext);
	if (!context) {
		throw new Error("useSettings must be used within a SettingsProvider");
	}
	return context;
}

interface SettingsProviderProps {
	children: ReactNode;
}

export function SettingsProvider({ children }: SettingsProviderProps) {
	const [open, setOpen] = useState(false);

	const openSettings = () => setOpen(true);

	return (
		<SettingsContext.Provider value={{ openSettings }}>
			{children}
			<SettingsDialog open={open} onOpenChange={setOpen} />
		</SettingsContext.Provider>
	);
}
