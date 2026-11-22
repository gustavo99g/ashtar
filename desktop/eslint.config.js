import js from "@eslint/js";
import boundaries from "eslint-plugin-boundaries";
import globals from "globals";
import tseslint from "typescript-eslint";

/*
 * Regras de arquitetura do frontend (ADR 0012).
 *
 * - `boundaries/dependencies`: quem pode importar quem entre as pastas de `src/`.
 * - `@typescript-eslint/no-restricted-imports`: quais pastas podem usar certos pacotes.
 * - `no-restricted-globals`: quais pastas podem usar `fetch` e `WebSocket`.
 *
 * Os blocos mais abaixo trocam a lista inteira de uma regra para uma pasta (o ESLint não junta
 * as opções de dois blocos), por isso as listas ficam em constantes.
 */

/** Só `lib/tauri` conversa com o Tauri. */
const TAURI_ONLY_IN_LIB = {
	group: ["@tauri-apps/*"],
	message: "Só src/lib/tauri importa o Tauri. Use as funções de @/lib/tauri.",
};

/** Só `features/voice` cria a sala do LiveKit. Importar o tipo `Room` vale em qualquer pasta. */
const ROOM_ONLY_IN_VOICE = {
	name: "livekit-client",
	importNames: ["Room"],
	allowTypeImports: true,
	message: "Só src/features/voice cria a Room. Use o useVoice().",
};

/** Dentro de `lib/tauri`, só a pasta `commands/` chama `invoke`. */
const INVOKE_ONLY_IN_COMMANDS = {
	name: "@tauri-apps/api/core",
	importNames: ["invoke"],
	message: "Use os wrappers de @/lib/tauri/commands.",
};

const FETCH_ONLY_IN_API = {
	name: "fetch",
	message: "Só src/lib/api chama fetch. Use o apiFetch de @/lib/api.",
};

const WEBSOCKET_ONLY_IN_REALTIME = {
	name: "WebSocket",
	message: "Só src/lib/realtime abre WebSocket.",
};

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
	},
	{
		files: ["src/**/*.{ts,tsx}"],
		plugins: { boundaries },
		settings: {
			// Resolve o `@/` do tsconfig, senão o plugin acha que `@/features/voice` é um pacote.
			"import/resolver": {
				typescript: { project: "./tsconfig.json" },
			},
			"boundaries/include": ["src/**/*"],
			"boundaries/elements": [
				{ type: "app", pattern: "src/app", partialMatch: false },
				{ type: "route", pattern: "src/routes/*", partialMatch: false },
				{ type: "layout", pattern: "src/layouts/*", partialMatch: false },
				{
					type: "feature",
					pattern: "src/features/*",
					partialMatch: false,
					capture: ["name"],
				},
				{ type: "ui", pattern: "src/components/ui", partialMatch: false },
				{ type: "lib", pattern: "src/lib", partialMatch: false },
			],
		},
		rules: {
			// A versão do typescript-eslint entende `import type`; a regra base fica desligada.
			"no-restricted-imports": "off",
			"@typescript-eslint/no-restricted-imports": [
				"error",
				{ paths: [ROOM_ONLY_IN_VOICE], patterns: [TAURI_ONLY_IN_LIB] },
			],
			"no-restricted-globals": [
				"error",
				FETCH_ONLY_IN_API,
				WEBSOCKET_ONLY_IN_REALTIME,
			],
			"boundaries/dependencies": [
				"error",
				{
					default: "allow",
					policies: [
						{
							to: { element: { type: "feature" } },
							disallow: { to: { element: { fileInternalPath: "!{index,window}.ts" } } },
							message:
								"Outra feature só entra pelo index.ts dela: importe de @/features/<nome>.",
						},
						{
							from: { element: { type: "ui" } },
							disallow: {
								to: {
									element: { type: ["feature", "layout", "route", "app"] },
								},
							},
							message:
								"components/ui não conhece o domínio: nada de features, telas ou app.",
						},
						{
							from: { element: { type: "lib" } },
							disallow: {
								to: {
									element: {
										type: ["ui", "feature", "layout", "route", "app"],
									},
								},
							},
							message:
								"lib não importa componentes, features, telas nem o app.",
						},
						{
							from: { element: { type: "feature" } },
							disallow: {
								to: { element: { type: ["layout", "route", "app"] } },
							},
							message: "Uma feature não importa telas, layouts nem o app.",
						},
					],
				},
			],
		},
	},
	{
		files: ["src/lib/tauri/**/*.{ts,tsx}"],
		rules: {
			"@typescript-eslint/no-restricted-imports": [
				"error",
				{ paths: [ROOM_ONLY_IN_VOICE, INVOKE_ONLY_IN_COMMANDS] },
			],
		},
	},
	{
		files: ["src/lib/tauri/commands/**/*.ts"],
		rules: {
			"@typescript-eslint/no-restricted-imports": [
				"error",
				{ paths: [ROOM_ONLY_IN_VOICE] },
			],
		},
	},
	{
		files: ["src/features/voice/**/*.{ts,tsx}"],
		rules: {
			"@typescript-eslint/no-restricted-imports": [
				"error",
				{ patterns: [TAURI_ONLY_IN_LIB] },
			],
		},
	},
	{
		files: ["src/lib/api/**/*.{ts,tsx}"],
		rules: {
			"no-restricted-globals": ["error", WEBSOCKET_ONLY_IN_REALTIME],
		},
	},
	{
		files: ["src/lib/realtime/**/*.{ts,tsx}"],
		rules: {
			"no-restricted-globals": ["error", FETCH_ONLY_IN_API],
		},
	},
	{
		// Scripts do CI rodam no Node.
		files: ["scripts/**/*.mjs"],
		languageOptions: {
			globals: globals.node,
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
