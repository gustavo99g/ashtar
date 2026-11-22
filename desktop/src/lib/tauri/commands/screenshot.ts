/**
 * O print da transmissão (decisões 22 a 24 do plano da v0.8). Espelha `commands/screenshot.rs`.
 */
import { call } from "./core";
import type { SourceRef } from "./screen-share";

export interface ScreenshotDone {
	/** A miniatura do aviso, em `data:image/jpeg;base64,...`. */
	thumbnail: string;
	/** Onde o arquivo ficou, se foi salvo. */
	path: string | null;
}

/** O print da própria transmissão, no tamanho cheio. `saveAs`: o nome do arquivo, para salvar. */
export function screenshotSource(source: SourceRef, saveAs: string | null) {
	return call<ScreenshotDone>("screenshot_source", { source, saveAs });
}

/** O print da transmissão de outra pessoa: o PNG tirado do `<video>`, em base64. */
export function screenshotImage(png: string, saveAs: string | null) {
	return call<ScreenshotDone>("screenshot_image", { png, saveAs });
}

/** Abre `Imagens\Ashtar`. */
export function openScreenshotDir() {
	return call<void>("open_screenshot_dir");
}
