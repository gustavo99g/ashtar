/**
 * Tocar o arquivo de um som (v0.9, ADR 0037). O arquivo vem do cache dos arquivos (`fileUrl`):
 * baixa na primeira vez e depois toca na hora. Sai pela saída escolhida em Voz e vídeo, no volume
 * do soundboard. Falhar (sem saída, arquivo que sumiu) é silêncio.
 */
import { fileUrl } from "@/lib/fileCache";

/**
 * A saída escolhida em Voz e vídeo, lida do `localStorage` (a chave é do `deviceChoiceStore` da
 * `features/voice`), como os sons dos avisos fazem.
 */
function chosenOutput(): string | null {
	try {
		const saved = JSON.parse(localStorage.getItem("ashtar-devices") ?? "null");
		const id = saved?.state?.output?.id;
		return typeof id === "string" && id !== "" ? id : null;
	} catch {
		return null;
	}
}

/** Toca o arquivo `fileId` no volume `volume` (de 0 a 1). */
export async function playSoundFile(
	fileId: string,
	volume: number,
): Promise<void> {
	try {
		const url = await fileUrl(fileId);
		const audio = new Audio(url) as HTMLAudioElement & {
			setSinkId?: (id: string) => Promise<void>;
		};
		audio.volume = Math.min(1, Math.max(0, volume));
		const output = chosenOutput();
		if (output && audio.setSinkId) await audio.setSinkId(output).catch(() => {});
		await audio.play();
	} catch {
		// Silêncio: um som perdido não vale um aviso.
	}
}

/** Baixa os arquivos antes, para o primeiro toque não esperar. */
export function preloadSoundFiles(fileIds: string[]): void {
	for (const id of fileIds) void fileUrl(id).catch(() => {});
}
