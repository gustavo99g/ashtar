/**
 * Único ponto de contato com `invoke()`. Nenhum outro arquivo do frontend deve importar `invoke` de
 * `@tauri-apps/api/core` diretamente. Cada comando Tauri ganha um wrapper tipado, no arquivo do
 * seu assunto; quem usa continua importando de `@/lib/tauri/commands`.
 */
export * from "./app";
export { type AppError, type AppErrorKind, isAppError } from "./core";
export * from "./identity";
export * from "./notifications";
export * from "./power";
export * from "./presence";
export * from "./screen-share";
export * from "./shortcuts";
export * from "./thumbnails";
export * from "./updater";
