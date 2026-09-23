import js from "@eslint/js";
import globals from "globals";
import tseslint from "typescript-eslint";

export default tseslint.config(
	{
		ignores: ["dist", "src-tauri", "node_modules"],
	},
	js.configs.recommended,
	...tseslint.configs.recommended,
	{
		files: ["**/*.{ts,tsx}"],
		languageOptions: {
			ecmaVersion: 2020,
			globals: globals.browser,
		},
		rules: {
			"no-restricted-imports": [
				"error",
				{
					paths: [
						{
							name: "@tauri-apps/api/core",
							importNames: ["invoke"],
							message: "Use os wrappers de @/lib/tauri/commands.",
						},
					],
				},
			],
		},
	},
	{
		// commands.ts é o único lugar autorizado a chamar `invoke` diretamente.
		files: ["src/lib/tauri/commands.ts"],
		rules: {
			"no-restricted-imports": "off",
		},
	},
	{
		// AudioWorkletProcessor roda num escopo próprio, sem os globais de browser.
		files: ["**/*.worklet.js"],
		languageOptions: {
			globals: {
				AudioWorkletProcessor: "readonly",
				registerProcessor: "readonly",
				sampleRate: "readonly",
				currentFrame: "readonly",
				currentTime: "readonly",
			},
		},
	},
);
