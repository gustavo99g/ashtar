/**
 * As miniaturas ao vivo do seletor e do preview da própria transmissão (ADR 0019). Espelha
 * `media/thumbnails.rs` e `commands/thumbnails.rs`. Mudou lá, muda aqui.
 */
import { Channel } from "@tauri-apps/api/core";
import { call } from "./core";
import type { SourceRef } from "./screen-share";

/** Uma miniatura nova: de qual fonte, e o JPEG. */
export interface Thumbnail {
	source: SourceRef;
	jpeg: Uint8Array;
}

/** O cabeçalho de cada mensagem: o tipo da fonte (1 byte) e o id (u64, little endian). */
const HEADER = 9;

/** Lê a mensagem do `Channel` (`thumbnail_message` no Rust). Curta demais dá `null`. */
export function parseThumbnail(message: ArrayBuffer): Thumbnail | null {
	if (message.byteLength < HEADER) return null;
	const view = new DataView(message);
	const kind = view.getUint8(0) === 0 ? "window" : "monitor";
	// Os ids (HWND e HMONITOR) cabem com folga nos 53 bits de um `number`.
	const id = Number(view.getBigUint64(1, true));
	return {
		source: { kind, id },
		jpeg: new Uint8Array(message, HEADER),
	};
}

/** Começa as miniaturas de `sources` e devolve o id para trocar as fontes e parar. */
export function thumbnailsStart(
	sources: SourceRef[],
	onThumbnail: (thumbnail: Thumbnail) => void,
) {
	const channel = new Channel<ArrayBuffer>();
	channel.onmessage = (message) => {
		const thumbnail = parseThumbnail(message);
		if (thumbnail) onThumbnail(thumbnail);
	};
	return call<number>("thumbnails_start", { sources, channel });
}

/** Troca as fontes (as que continuam não recomeçam). */
export function thumbnailsUpdate(id: number, sources: SourceRef[]) {
	return call<void>("thumbnails_update", { id, sources });
}

export function thumbnailsStop(id: number) {
	return call<void>("thumbnails_stop", { id });
}

/**
 * Confere se a própria transmissão está saindo preta (`commands/black_watch.rs`): `onChange(true)`
 * depois de 5 segundos pretos, `onChange(false)` quando volta a ter imagem. Devolve o id para parar.
 */
export function blackWatchStart(
	source: SourceRef,
	onChange: (black: boolean) => void,
) {
	const channel = new Channel<boolean>();
	channel.onmessage = onChange;
	return call<number>("black_watch_start", { source, channel });
}

export function blackWatchStop(id: number) {
	return call<void>("black_watch_stop", { id });
}
