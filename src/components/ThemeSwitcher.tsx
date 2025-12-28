import { useState, useEffect, useCallback } from "react";
import { Button } from "@/components/ui/button";
import {
	DropdownMenu,
	DropdownMenuContent,
	DropdownMenuItem,
	DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Sun, Moon, Monitor } from "@phosphor-icons/react";
import { api } from "@/lib/tauri";

type Theme = "light" | "dark" | "system";

export function ThemeSwitcher() {
	const [theme, setTheme] = useState<Theme>(() => {
		if (typeof window !== "undefined") {
			const saved = localStorage.getItem("theme") as Theme;
			if (saved) {
				return saved;
			}
		}
		return "system";
	});

	const applyTheme = useCallback((currentTheme: Theme) => {
		const root = window.document.documentElement;
		if (currentTheme === "system") {
			const systemTheme = window.matchMedia("(prefers-color-scheme: dark)")
				.matches
				? "dark"
				: "light";
			root.classList.toggle("dark", systemTheme === "dark");
		} else {
			root.classList.toggle("dark", currentTheme === "dark");
		}
	}, []);

	useEffect(() => {
		api.settings
			.get("theme")
			.then((savedTheme) => {
				if (savedTheme) {
					setTheme(savedTheme as Theme);
					localStorage.setItem("theme", savedTheme);
				}
			})
			.catch(console.error);
	}, []);

	useEffect(() => {
		applyTheme(theme);
		localStorage.setItem("theme", theme);

		if (theme === "system") {
			const mediaQuery = window.matchMedia("(prefers-color-scheme: dark)");

			const handleMediaChange = () => {
				applyTheme("system");
			};
			mediaQuery.addEventListener("change", handleMediaChange);

			let unlistenFocus: (() => void) | undefined;

			import("@tauri-apps/api/window")
				.then(async ({ getCurrentWindow }) => {
					const currentWindow = getCurrentWindow();
					unlistenFocus = await currentWindow.onFocusChanged(
						({ payload: focused }) => {
							if (focused) {
								applyTheme("system");
							}
						},
					);
				})
				.catch(console.error);

			return () => {
				mediaQuery.removeEventListener("change", handleMediaChange);
				if (unlistenFocus) {
					unlistenFocus();
				}
			};
		}
	}, [theme, applyTheme]);

	const handleThemeChange = async (newTheme: Theme) => {
		setTheme(newTheme);
		try {
			await api.settings.set("theme", newTheme);
		} catch (error) {
			console.error("Failed to save theme:", error);
		}
	};

	return (
		<DropdownMenu>
			<DropdownMenuTrigger render={<Button variant="ghost" size="icon" />}>
				{theme === "dark" ? (
					<Moon />
				) : theme === "light" ? (
					<Sun />
				) : (
					<Monitor />
				)}
				<span className="sr-only">Toggle theme</span>
			</DropdownMenuTrigger>
			<DropdownMenuContent align="end">
				<DropdownMenuItem onClick={() => handleThemeChange("light")}>
					<Sun />
					Light
				</DropdownMenuItem>
				<DropdownMenuItem onClick={() => handleThemeChange("dark")}>
					<Moon />
					Dark
				</DropdownMenuItem>
				<DropdownMenuItem onClick={() => handleThemeChange("system")}>
					<Monitor />
					System
				</DropdownMenuItem>
			</DropdownMenuContent>
		</DropdownMenu>
	);
}
