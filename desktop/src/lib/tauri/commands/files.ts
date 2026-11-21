/**
 * O Baixar dos arquivos do chat (ADR 0031). Espelha `commands/files.rs`: o Rust grava direto na
 * pasta Downloads, sem o arquivo passar pela memória da tela. A recusa é o mesmo `ApiError` do
 * `apiFetch`.
 */
import { Channel, invoke } from "@tauri-apps/api/core";
// Direto dos arquivos, e não do `@/lib/api`: o `client.ts` de lá importa estes comandos.
import { errorFromCommand } from "@/lib/api/errors";
import { sessionToken } from "@/lib/api/session";

/** Quanto já chegou, em bytes, e o total (sem ele, `null`). */
export interface DownloadProgress {
	received: number;
	total: number | null;
}

/** Baixa o arquivo `id` como `name` (ou "nome (1)" se já existir) e devolve o caminho no disco. */
export async function downloadFile(
	id: string,
	name: string,
	onProgress?: (progress: DownloadProgress) => void,
): Promise<string> {
	const channel = new Channel<DownloadProgress>();
	channel.onmessage = (progress) => onProgress?.(progress);
	try {
		return await invoke<string>("file_download", {
			id,
			name,
			token: sessionToken() ?? "",
			onProgress: channel,
		});
	} catch (rejection) {
		throw errorFromCommand(rejection);
	}
}
