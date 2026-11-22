/**
 * Copiar uma imagem do chat para a área de transferência. O Chromium só aceita PNG no
 * `ClipboardItem`, então a imagem (o original, do cache de arquivos) é redesenhada num canvas e sai
 * em PNG. O GIF vai pelo primeiro quadro.
 */
import { fileUrl } from "@/lib/fileCache";

async function toPng(fileId: string): Promise<Blob> {
	const image = new Image();
	image.src = await fileUrl(fileId);
	await image.decode();
	const canvas = document.createElement("canvas");
	canvas.width = image.naturalWidth;
	canvas.height = image.naturalHeight;
	canvas.getContext("2d")?.drawImage(image, 0, 0);
	return new Promise<Blob>((resolve, reject) =>
		canvas.toBlob(
			(png) => (png ? resolve(png) : reject(new Error("canvas vazio"))),
			"image/png",
		),
	);
}

export async function copyImageFile(fileId: string): Promise<void> {
	// A promessa vai direto no ClipboardItem: a escrita começa ainda dentro do clique.
	await navigator.clipboard.write([
		new ClipboardItem({ "image/png": toPng(fileId) }),
	]);
}
