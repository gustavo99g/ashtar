/**
 * Os anexos (ADR 0032, decisões 20 e 21 do plano da v0.7): os limites, os textos do cartão, o
 * espaço da imagem no chat e a miniatura feita aqui antes de enviar (a API nunca decodifica uma
 * imagem).
 */

/** Quantos arquivos uma mensagem leva, como na API. */
export const ATTACHMENTS_MAX = 10;
/** O maior anexo, como na API. */
export const ATTACHMENT_MAX_BYTES = 100 * 1024 * 1024;
/** O lado maior da miniatura enviada. */
export const THUMBNAIL_SIDE = 640;
/** A caixa da imagem no chat. */
export const IMAGE_BOX = { width: 400, height: 300 };

const IMAGE_TYPES = new Set([
	"image/png",
	"image/jpeg",
	"image/webp",
	"image/gif",
]);

/** As imagens que o chat mostra (as outras viram o cartão de arquivo). */
export function isImage(mime: string): boolean {
	return IMAGE_TYPES.has(mime);
}

/** "312 KB", "4,2 MB". */
export function fileSize(bytes: number): string {
	const units = ["B", "KB", "MB", "GB"];
	let value = bytes;
	let unit = 0;
	while (value >= 1024 && unit < units.length - 1) {
		value /= 1024;
		unit += 1;
	}
	const digits = value < 10 && unit > 0 ? 1 : 0;
	return `${value.toLocaleString("pt-BR", { maximumFractionDigits: digits })} ${units[unit]}`;
}

/** O tipo do arquivo em uma palavra, para o cartão: "imagem", "vídeo", "PDF", "ZIP"... */
export function fileKindLabel(mime: string, name: string): string {
	if (mime.startsWith("image/")) return "imagem";
	if (mime.startsWith("video/")) return "vídeo";
	if (mime.startsWith("audio/")) return "áudio";
	if (mime === "application/pdf") return "PDF";
	const dot = name.lastIndexOf(".");
	const ext = dot > 0 ? name.slice(dot + 1) : "";
	return ext && ext.length <= 5 ? ext.toUpperCase() : "arquivo";
}

/** "vídeo · 48 MB". */
export function fileCaption(mime: string, name: string, bytes: number): string {
	return `${fileKindLabel(mime, name)} · ${fileSize(bytes)}`;
}

/** O tamanho da imagem no chat: cabe na caixa sem aumentar; sem as dimensões, a caixa inteira. */
export function fitBox(
	width: number | null | undefined,
	height: number | null | undefined,
	box = IMAGE_BOX,
): { width: number; height: number } {
	if (!width || !height) return { ...box };
	const scale = Math.min(1, box.width / width, box.height / height);
	return {
		width: Math.max(1, Math.round(width * scale)),
		height: Math.max(1, Math.round(height * scale)),
	};
}

/** O que impede de anexar mais `adding` arquivos a `current`, ou `null`. */
export function attachProblem(
	current: number,
	adding: readonly { size: number; name: string }[],
): string | null {
	if (current + adding.length > ATTACHMENTS_MAX) {
		return `Uma mensagem leva até ${ATTACHMENTS_MAX} arquivos.`;
	}
	const big = adding.find((file) => file.size > ATTACHMENT_MAX_BYTES);
	if (big) return `${big.name} passa de 100 MB.`;
	return null;
}

export interface Thumbnail {
	blob: Blob;
	/** As dimensões da imagem original. */
	width: number;
	height: number;
}

/**
 * A miniatura de uma imagem: o lado maior em 640 px, WebP. `null` se a imagem não abre aqui
 * (aí ela vai sem miniatura, e o chat mostra o cartão de arquivo).
 */
export async function makeThumbnail(file: Blob): Promise<Thumbnail | null> {
	if (!isImage(file.type) || typeof createImageBitmap !== "function") {
		return null;
	}
	let bitmap: ImageBitmap;
	try {
		bitmap = await createImageBitmap(file);
	} catch {
		return null;
	}
	try {
		const { width, height } = bitmap;
		const scale = Math.min(1, THUMBNAIL_SIDE / Math.max(width, height));
		const canvas = document.createElement("canvas");
		canvas.width = Math.max(1, Math.round(width * scale));
		canvas.height = Math.max(1, Math.round(height * scale));
		const context = canvas.getContext("2d");
		if (!context) return null;
		context.imageSmoothingQuality = "high";
		context.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
		const blob = await new Promise<Blob | null>((resolve) =>
			canvas.toBlob(resolve, "image/webp", 0.82),
		);
		return blob ? { blob, width, height } : null;
	} finally {
		bitmap.close();
	}
}

/**
 * Os anexos numa linha, para quando a mensagem não tem texto (a lista de conversas, o aviso):
 * "📎 Imagem", "📎 notas.pdf", "📎 3 arquivos".
 */
export function attachmentsLabel(
	files: readonly { name: string; mime: string }[],
): string {
	if (files.length === 0) return "";
	if (files.length > 1) return `📎 ${files.length} arquivos`;
	return `📎 ${isImage(files[0].mime) ? "Imagem" : files[0].name}`;
}
