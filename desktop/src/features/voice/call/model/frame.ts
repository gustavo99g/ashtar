/**
 * Copiar um quadro da transmissão (ADR 0024): o quadro atual do `<video>`, no tamanho que está
 * chegando (`videoWidth` × `videoHeight`, não o do bloco nem o ampliado), como PNG. Com a transmissão
 * pausada, o `<video>` segura o último quadro, e é ele que vai.
 */

/** O PNG do quadro atual, ou `null` antes do primeiro quadro. */
export async function captureFrame(video: HTMLVideoElement): Promise<Blob | null> {
	const { videoWidth: width, videoHeight: height } = video;
	if (width === 0 || height === 0) return null;
	const canvas = document.createElement("canvas");
	canvas.width = width;
	canvas.height = height;
	const context = canvas.getContext("2d");
	if (!context) return null;
	context.drawImage(video, 0, 0, width, height);
	return new Promise((resolve) => canvas.toBlob(resolve, "image/png"));
}

/** Põe o PNG na área de transferência. Lança se o WebView recusar. */
export async function copyImage(png: Blob): Promise<void> {
	await navigator.clipboard.write([new ClipboardItem({ "image/png": png })]);
}
