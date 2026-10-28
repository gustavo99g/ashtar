/// <reference types="vite/client" />
/** Versão do app, do `desktop/package.json` (`define` no `vite.config.ts`). */
declare const __APP_VERSION__: string;

interface ImportMetaEnv {
	/** URL base da API (`api/`), sem barra final. Obrigatória fora do desenvolvimento. */
	readonly VITE_API_URL?: string;
	/** Código de acesso da API (decisão 11). Sem ele, o cabeçalho não é enviado. */
	readonly VITE_ACCESS_CODE?: string;
}

interface ImportMeta {
	readonly env: ImportMetaEnv;
}
