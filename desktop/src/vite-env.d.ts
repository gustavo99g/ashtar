/// <reference types="vite/client" />

interface ImportMetaEnv {
  /** URL base da API (`api/`), sem barra final. Obrigatória fora do desenvolvimento. */
  readonly VITE_API_URL?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
