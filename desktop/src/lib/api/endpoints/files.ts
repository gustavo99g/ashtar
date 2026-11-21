/**
 * Os arquivos (ADR 0031): o envio e a leitura. O token vai no cabeçalho, nunca na URL: a tela
 * mostra o arquivo por uma URL `blob:` (`lib/fileCache.ts`).
 */
import { apiFetch } from "../client";
import type { FileKind, FileView } from "../generated";

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
}

/**
 * `POST /api/files`: o corpo é o próprio arquivo. Rejeita com `file_too_large` (413), `disk_full`
 * (507) ou `invalid_request`.
 */
export async function uploadFile(
	file: Blob,
	options: UploadOptions,
): Promise<FileView> {
	const query = new URLSearchParams({ kind: options.kind, name: options.name });
	if (options.width) query.set("width", String(Math.round(options.width)));
	if (options.height) query.set("height", String(Math.round(options.height)));
	if (options.durationMs !== undefined) {
		query.set("duration_ms", String(Math.round(options.durationMs)));
	}
	if (options.thumbnail) query.set("thumbnail", options.thumbnail);
	const response = await apiFetch(
		`/api/files?${query.toString()}`,
		{
			method: "POST",
			headers: { "Content-Type": file.type || "application/octet-stream" },
			body: file,
		},
		UPLOAD_TIMEOUT_MS,
	);
	return (await response.json()) as FileView;
}

/** `GET /api/files/{id}`: o arquivo inteiro. Sem acesso, `not_found`. */
export async function fetchFile(id: string): Promise<Blob> {
	const response = await apiFetch(`/api/files/${encodeURIComponent(id)}`);
	return response.blob();
}
