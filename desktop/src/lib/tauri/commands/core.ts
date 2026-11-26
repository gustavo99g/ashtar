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
	| "Publish"
	| "Internal"
	| "Unsupported"
	| "Update";

export interface AppError {
	kind: AppErrorKind;
	/** O texto para a pessoa: o que aconteceu e o que fazer, sem termo técnico. */
	message: string;
	/** O texto técnico que o Rust mandou, que vai para o log. */
	detail?: string;
}

/**
 * O texto de cada tipo de erro dos comandos (v0.9): o Rust manda o detalhe técnico ("falha na
 * captura de vídeo: DXGI_ERROR_..."), que a pessoa não entende; ele fica no `detail` e no log.
 */
const FRIENDLY: Record<AppErrorKind, string> = {
	SourceNotFound: "Essa janela ou tela não existe mais. Escolha outra.",
	AlreadySharing: "Você já está transmitindo.",
	VideoCapture:
		"Não deu para capturar a imagem. Tente de novo ou escolha outra fonte.",
	AudioCapture: "Não deu para capturar o som. Tente de novo.",
	Publish: "Não deu para transmitir. Confira a internet e tente de novo.",
	Internal:
		"Algo deu errado no app. Tente de novo; se continuar, use Enviar logs em Configurações › Aplicativo.",
	Unsupported: "Isso não funciona neste computador.",
	Update: "Tente de novo mais tarde.",
};

/** Troca a mensagem técnica de um erro de comando pela da pessoa, guardando o detalhe. */
function friendly(error: AppError): AppError {
	const message = FRIENDLY[error.kind];
	if (message === undefined) return error;
	console.error(`Comando falhou (${error.kind}):`, error.message);
	return { kind: error.kind, message, detail: error.message };
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
			// Um erro da API repassado pelo Rust (`{ status, kind, message }`) já vem em português.
			throw "status" in error ? error : friendly(error);
		}

		// Rejeição que não é um `AppError` (ex.: erro do próprio Tauri, que chega como string).
		throw friendly({ kind: "Internal", message: String(error) });
	}
}
