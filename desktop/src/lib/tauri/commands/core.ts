/**
 * O que todos os comandos dividem: o `AppError` e o `call()`, que é o único jeito de chamar o
 * `invoke()` (a regra `no-restricted-imports` do ESLint garante isso: ver eslint.config.js).
 *
 * Os comandos rejeitam a Promise com um `AppError` (Etapa 2.2 do docs/plans/v0.1-reorganizacao.md);
 * o `call()` converte qualquer outra rejeição (por exemplo, um erro do próprio Tauri, que chega
 * como `string`) para o mesmo formato.
 */
import { type InvokeArgs, invoke } from "@tauri-apps/api/core";

export type AppErrorKind =
	| "SourceNotFound"
	| "AlreadySharing"
	| "VideoCapture"
	| "AudioCapture"
	| "Internal"
	| "Unsupported"
	| "Update";

export interface AppError {
	kind: AppErrorKind;
	message: string;
}

export function isAppError(value: unknown): value is AppError {
	return (
		typeof value === "object" &&
		value !== null &&
		"kind" in value &&
		"message" in value
	);
}

export async function call<T>(command: string, args?: InvokeArgs): Promise<T> {
	try {
		return await invoke<T>(command, args);
	} catch (error) {
		if (isAppError(error)) {
			throw error;
		}

		// Rejeição que não é um `AppError` (ex.: erro do próprio Tauri, que chega como string).
		throw {
			kind: "Internal",
			message: String(error),
		} satisfies AppError;
	}
}
