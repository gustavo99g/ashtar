import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { readFileSync } from "fs";
import path from "path";
import { defineConfig } from "vite";

const host = process.env.TAURI_DEV_HOST;

// A versão do app é a do package.json (decisão 4), a mesma que o Tauri usa.
const appVersion: string = JSON.parse(
	readFileSync(path.resolve(__dirname, "package.json"), "utf8"),
).version;

// https://vite.dev/config/
export default defineConfig(async () => ({
	plugins: [react(), tailwindcss()],
	define: {
		__APP_VERSION__: JSON.stringify(appVersion),
	},
	resolve: {
		alias: {
			"@": path.resolve(__dirname, "./src"),
		},
	},

	// O .env fica na raiz do monorepo (compartilhado com a api/), não em
	// desktop/. Só variáveis com prefixo VITE_ chegam ao código do
	// browser; o resto (segredos da api/) não aparece pro webview.
	envDir: path.resolve(__dirname, ".."),

	// Vite options tailored for Tauri development and only applied in `tauri dev` or `tauri build`
	//
	// 1. prevent Vite from obscuring rust errors
	clearScreen: false,

	// O scanner de optimizeDeps varre o projeto atrás de HTML pra achar
	// dependências, e isso não é afetado por `server.watch.ignored` (abaixo).
	// Sem restringir as entradas, ele acaba entrando em
	// `src-tauri/target/doc` (milhares de .html gerados pelo `cargo doc`)
	// e estoura o limite de arquivos abertos do SO (EMFILE).
	optimizeDeps: {
		entries: ["index.html"],
	},

	// 2. tauri expects a fixed port, fail if that port is not available
	server: {
		port: 1420,
		strictPort: true,
		host: host || false,
		hmr: host
			? {
					protocol: "ws",
					host,
					port: 1421,
				}
			: undefined,
		watch: {
			// 3. tell Vite to ignore watching `src-tauri`
			ignored: ["**/src-tauri/**"],
		},
	},
}));
