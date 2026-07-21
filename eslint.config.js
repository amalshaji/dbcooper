import js from "@eslint/js";
import globals from "globals";
import reactHooks from "eslint-plugin-react-hooks";
import reactRefresh from "eslint-plugin-react-refresh";
import tseslint from "typescript-eslint";
import { defineConfig, globalIgnores } from "eslint/config";

export default defineConfig([
	globalIgnores([
		"dist",
		"docs/dist",
		"node_modules",
		"docs/node_modules",
		"src-tauri/target",
	]),
	{
		files: ["src/**/*.{ts,tsx}", "vite.config.ts"],
		extends: [
			js.configs.recommended,
			tseslint.configs.recommended,
			reactHooks.configs.flat.recommended,
			reactRefresh.configs.vite,
		],
		languageOptions: {
			ecmaVersion: 2020,
			globals: globals.browser,
		},
		rules: {
			"@typescript-eslint/no-unused-vars": [
				"error",
				{
					argsIgnorePattern: "^_",
					caughtErrorsIgnorePattern: "^_",
				},
			],
		},
	},
	{
		// Shared UI and context modules intentionally export components with helpers.
		files: [
			"src/components/ui/badge.tsx",
			"src/components/ui/button-group.tsx",
			"src/components/ui/button.tsx",
			"src/components/ui/combobox.tsx",
			"src/components/ui/sidebar.tsx",
			"src/components/ui/tabs.tsx",
			"src/contexts/SettingsContext.tsx",
			"src/contexts/ThemeContext.tsx",
		],
		rules: { "react-refresh/only-export-components": "off" },
	},
]);
