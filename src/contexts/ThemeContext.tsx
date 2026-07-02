import {
	createContext,
	useCallback,
	useContext,
	useEffect,
	useState,
	type ReactNode,
} from "react";
import { api } from "@/lib/tauri";

export type Theme = "light" | "dark" | "system";

function resolveSystemTheme(): "light" | "dark" {
	return window.matchMedia("(prefers-color-scheme: dark)").matches
		? "dark"
		: "light";
}

function applyThemeClass(theme: Theme) {
	const root = window.document.documentElement;
	const effective = theme === "system" ? resolveSystemTheme() : theme;
	root.classList.toggle("dark", effective === "dark");
}

interface ThemeContextValue {
	theme: Theme;
	setTheme: (theme: Theme) => void;
	/** Flip between light and dark, resolving "system" to the current OS appearance first. */
	toggleTheme: () => void;
}

const ThemeContext = createContext<ThemeContextValue | null>(null);

export function useTheme() {
	const context = useContext(ThemeContext);
	if (!context) {
		throw new Error("useTheme must be used within a ThemeProvider");
	}
	return context;
}

export function ThemeProvider({ children }: { children: ReactNode }) {
	const [theme, setThemeState] = useState<Theme>(
		() => (localStorage.getItem("theme") as Theme) || "system",
	);

	// Persisted settings are the source of truth; hydrate once on mount.
	useEffect(() => {
		api.settings
			.get("theme")
			.then((saved) => {
				if (saved) {
					setThemeState(saved as Theme);
				}
			})
			.catch(console.error);
	}, []);

	// Apply + persist whenever the theme changes. While on "system", re-resolve
	// on OS scheme changes and on window focus (Tauri doesn't always emit the former).
	useEffect(() => {
		applyThemeClass(theme);
		localStorage.setItem("theme", theme);

		if (theme !== "system") {
			return;
		}

		const mediaQuery = window.matchMedia("(prefers-color-scheme: dark)");
		const reapply = () => applyThemeClass("system");
		mediaQuery.addEventListener("change", reapply);

		let unlistenFocus: (() => void) | undefined;
		import("@tauri-apps/api/window")
			.then(async ({ getCurrentWindow }) => {
				unlistenFocus = await getCurrentWindow().onFocusChanged(
					({ payload: focused }) => {
						if (focused) {
							reapply();
						}
					},
				);
			})
			.catch(console.error);

		return () => {
			mediaQuery.removeEventListener("change", reapply);
			unlistenFocus?.();
		};
	}, [theme]);

	const setTheme = useCallback((next: Theme) => {
		setThemeState(next);
		api.settings.set("theme", next).catch((error) => {
			console.error("Failed to save theme:", error);
		});
	}, []);

	const toggleTheme = useCallback(() => {
		const effective = theme === "system" ? resolveSystemTheme() : theme;
		setTheme(effective === "dark" ? "light" : "dark");
	}, [theme, setTheme]);

	return (
		<ThemeContext.Provider value={{ theme, setTheme, toggleTheme }}>
			{children}
		</ThemeContext.Provider>
	);
}
