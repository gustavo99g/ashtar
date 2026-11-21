/**
 * Os arquivos (ADR 0031): o envio e a leitura. O token vai no cabeçalho, nunca na URL: a tela
 * mostra o arquivo por uma URL `blob:` (`lib/fileCache.ts`), e o Baixar é um comando do Rust
 * (`lib/tauri/commands/files.ts`).
 *
 * O envio usa `XMLHttpRequest`, e não o `apiFetch`: o `fetch` não conta o progresso da subida, e o
 * cartão do anexo mostra a barra. O resto é igual ao `apiFetch`: os cabeçalhos, o tempo limite, o
 * `ApiError` e um login de novo depois de um 401.
 */
import { apiFetch } from "../client";
import { apiUrl } from "../config";
import {
	ApiError,
	errorFromResponse,
	NETWORK_MESSAGE,
	TIMEOUT_MESSAGE,
} from "../errors";
import type { FileKind, FileView } from "../generated";
import { renewSession, sessionToken } from "../session";

/** O envio de um arquivo de até 100 MB tem até 10 minutos, como na API. */
const UPLOAD_TIMEOUT_MS = 10 * 60 * 1000;

export interface UploadOptions {
	kind: FileKind;
	/** O nome original ("print.png"). */
	name: string;
	/** As dimensões e a duração medidas aqui (a API não decodifica). */
	width?: number;
	height?: number;
	durationMs?: number;
	/** A miniatura deste arquivo, enviada antes. */
	thumbnail?: string;
	/** Quanto já subiu, de 0 a 1. */
	onProgress?: (fraction: number) => void;
	/** Cancela o envio (rejeita com o `AbortError`). */
	signal?: AbortSignal;
}

function uploadPath(options: UploadOptions): string {
	const query = new URLSearchParams({ kind: options.kind, name: options.name });
	if (options.width) query.set("width", String(Math.round(options.width)));
	if (options.height) query.set("height", String(Math.round(options.height)));
	if (options.durationMs !== undefined) {
		query.set("duration_ms", String(Math.round(options.durationMs)));
	}
	if (options.thumbnail) query.set("thumbnail", options.thumbnail);
	return `/api/files?${query.toString()}`;
}

/** Um envio: resolve com o status e o corpo, ou rejeita com o `ApiError` de rede ou de tempo. */
function post(
	path: string,
	file: Blob,
	token: string | null,
	options: UploadOptions,
): Promise<{ status: number; body: unknown }> {
	return new Promise((resolve, reject) => {
		const request = new XMLHttpRequest();
		request.open("POST", apiUrl(path));
		request.timeout = UPLOAD_TIMEOUT_MS;
		request.setRequestHeader("X-App-Version", __APP_VERSION__);
		request.setRequestHeader(
			"Content-Type",
			file.type || "application/octet-stream",
		);
		if (token) request.setRequestHeader("Authorization", `Bearer ${token}`);
		request.upload.onprogress = (event) => {
			if (event.lengthComputable && event.total > 0) {
				options.onProgress?.(event.loaded / event.total);
			}
		};
		request.onload = () => {
			let body: unknown = null;
			try {
				body = JSON.parse(request.responseText);
			} catch {
				// Sem JSON: o `errorFromResponse` usa o status.
			}
			resolve({ status: request.status, body });
		};
		request.onerror = () =>
			reject(
				new ApiError({ status: 0, kind: "network", message: NETWORK_MESSAGE }),
			);
		request.ontimeout = () =>
			reject(
				new ApiError({ status: 0, kind: "timeout", message: TIMEOUT_MESSAGE }),
			);
		request.onabort = () =>
			reject(new DOMException("O envio foi cancelado.", "AbortError"));
		options.signal?.addEventListener("abort", () => request.abort(), {
			once: true,
		});
		if (options.signal?.aborted) {
			request.abort();
			return;
		}
		request.send(file);
	});
}

/**
 * `POST /api/files`: o corpo é o próprio arquivo. Rejeita com `file_too_large` (413), `disk_full`
 * (507) ou `invalid_request`.
 */
export async function uploadFile(
	file: Blob,
	options: UploadOptions,
): Promise<FileView> {
	const path = uploadPath(options);
	const sent = sessionToken();
	let answer = await post(path, file, sent, options);
	let error =
		answer.status >= 200 && answer.status < 300
			? null
			: errorFromResponse(answer.status, answer.body);
	if (
		error?.kind === "unauthenticated" &&
		sent !== null &&
		(await renewSession(sent))
	) {
		answer = await post(path, file, sessionToken(), options);
		error =
			answer.status >= 200 && answer.status < 300
				? null
				: errorFromResponse(answer.status, answer.body);
	}
	if (error) throw error;
	options.onProgress?.(1);
	return answer.body as FileView;
}

/** `GET /api/files/{id}`: o arquivo inteiro. Sem acesso, `not_found`. */
export async function fetchFile(id: string): Promise<Blob> {
	const response = await apiFetch(`/api/files/${encodeURIComponent(id)}`);
	return response.blob();
}
