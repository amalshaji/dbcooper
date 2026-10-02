import { useState, type ReactNode } from "react";
import { SettingsDialog } from "@/components/SettingsDialog";
import { SettingsContext } from "./settings";

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
