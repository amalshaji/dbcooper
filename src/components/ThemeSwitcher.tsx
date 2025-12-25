import { useState, useEffect } from "react";
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
        // Immediately apply theme to prevent flash
        const root = window.document.documentElement;
        if (saved === "system") {
          const systemTheme = window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
          root.classList.toggle("dark", systemTheme === "dark");
        } else {
          root.classList.toggle("dark", saved === "dark");
        }
        return saved;
      }
    }
    return "system";
  });

  useEffect(() => {
    api.settings.get("theme").then((savedTheme) => {
      if (savedTheme) {
        setTheme(savedTheme as Theme);
        localStorage.setItem("theme", savedTheme);
      }
    }).catch(console.error);
  }, []);

  useEffect(() => {
    const root = window.document.documentElement;

    const applyTheme = (t: Theme) => {
      if (t === "system") {
        const systemTheme = window.matchMedia("(prefers-color-scheme: dark)").matches
          ? "dark"
          : "light";
        root.classList.toggle("dark", systemTheme === "dark");
      } else {
        root.classList.toggle("dark", t === "dark");
      }
    };

    applyTheme(theme);
    localStorage.setItem("theme", theme);

    if (theme === "system") {
      const mediaQuery = window.matchMedia("(prefers-color-scheme: dark)");
      const handler = () => applyTheme("system");

      // Listen for real-time system theme changes
      mediaQuery.addEventListener("change", handler);

      // Also recheck when app regains visibility or focus
      // This catches theme changes that occurred while app was in background
      const handleVisibilityChange = () => {
        if (document.visibilityState === "visible") {
          applyTheme("system");
        }
      };
      const handleFocus = () => applyTheme("system");

      document.addEventListener("visibilitychange", handleVisibilityChange);
      window.addEventListener("focus", handleFocus);

      return () => {
        mediaQuery.removeEventListener("change", handler);
        document.removeEventListener("visibilitychange", handleVisibilityChange);
        window.removeEventListener("focus", handleFocus);
      };
    }
  }, [theme]);

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
        {theme === "dark" ? <Moon /> : theme === "light" ? <Sun /> : <Monitor />}
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
