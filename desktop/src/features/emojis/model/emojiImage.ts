/**
 * O emoji antes de subir (decisão 31 do plano da v0.7): PNG, JPEG e WebP viram 128×128 em WebP
 * (a imagem inteira, centrada, com o fundo transparente); o GIF animado vai como está, até 256 KB.
 */

export const EMOJI_SIZE = 128;
export const EMOJI_MAX_BYTES = 256 * 1024;
const STATIC = ["image/png", "image/jpeg", "image/webp"];

/** Um nome de emoji válido: 2 a 32 letras minúsculas, números e `_`. */
export const EMOJI_NAME = /^[a-z0-9_]{2,32}$/;

/** O problema do arquivo escolhido, ou `null`. */
export function emojiFileProblem(file: File): string | null {
	if (file.type === "image/gif") {
		return file.size > EMOJI_MAX_BYTES ? "O GIF pode ter até 256 KB." : null;
	}
	return STATIC.includes(file.type)
		? null
		: "O emoji precisa ser PNG, JPEG, WebP ou GIF.";
}

/** Um nome a partir do arquivo ("Kekw Feliz.png" vira "kekw_feliz"), para começar. */
export function nameFromFile(fileName: string): string {
	return fileName
		.replace(/\.[^.]*$/, "")
		.normalize("NFD")
		.replace(/\p{M}/gu, "")
		.toLowerCase()
		.replace(/[^a-z0-9_]+/g, "_")
		.replace(/^_+|_+$/g, "")
		.slice(0, 32);
}

/** O problema do nome, ou `null`. */
export function emojiNameProblem(name: string): string | null {
	return EMOJI_NAME.test(name)
		? null
		: "Use de 2 a 32 letras minúsculas, números ou _.";
}

/** Onde desenhar a imagem num quadrado de `size`, sem cortar. */
export function containBox(
	width: number,
	height: number,
	size = EMOJI_SIZE,
): { x: number; y: number; width: number; height: number } {
	const scale = Math.min(size / width, size / height);
	const w = Math.round(width * scale);
	const h = Math.round(height * scale);
	return { x: Math.round((size - w) / 2), y: Math.round((size - h) / 2), width: w, height: h };
}

export interface PreparedEmoji {
	blob: Blob;
	name: string;
	width: number;
	height: number;
}

export async function prepareEmojiImage(file: File): Promise<PreparedEmoji> {
	const problem = emojiFileProblem(file);
	if (problem) throw new Error(problem);
	if (file.type === "image/gif") {
		return { blob: file, name: file.name || "emoji.gif", width: EMOJI_SIZE, height: EMOJI_SIZE };
	}
	const bitmap = await createImageBitmap(file);
	const canvas = document.createElement("canvas");
	canvas.width = EMOJI_SIZE;
	canvas.height = EMOJI_SIZE;
	const context = canvas.getContext("2d");
	if (!context) throw new Error("Não deu para preparar a imagem.");
	const box = containBox(bitmap.width, bitmap.height);
	context.imageSmoothingQuality = "high";
	context.drawImage(bitmap, box.x, box.y, box.width, box.height);
	bitmap.close();
	const blob = await new Promise<Blob>((resolve, reject) =>
		canvas.toBlob(
			(out) => (out ? resolve(out) : reject(new Error("Não deu para preparar a imagem."))),
			"image/webp",
			0.9,
		),
	);
	return { blob, name: "emoji.webp", width: EMOJI_SIZE, height: EMOJI_SIZE };
}
