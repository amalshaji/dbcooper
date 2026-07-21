import { Button } from "@/components/ui/button";
import type { Theme } from "@/contexts/ThemeContext";

interface ThemeSelectorProps {
	theme: Theme;
	compact?: boolean;
	onThemeChange: (theme: Theme) => void;
}

const themes: Theme[] = ["light", "dark", "system"];

export function ThemeSelector({
	theme,
	compact,
	onThemeChange,
}: ThemeSelectorProps) {
	return (
		<fieldset className="flex rounded-md border bg-muted/50 p-0.5">
			<legend className="sr-only">Theme</legend>
			{themes.map((option) => {
				const selected = theme === option;

				return (
					<Button
						key={option}
						type="button"
						variant="ghost"
						size={compact ? "sm" : "default"}
						className={
							selected
								? "flex-1 border-border bg-background text-foreground shadow-sm hover:bg-background capitalize"
								: "flex-1 capitalize text-muted-foreground"
						}
						aria-pressed={selected}
						onClick={() => onThemeChange(option)}
					>
						{option}
					</Button>
				);
			})}
		</fieldset>
	);
}
