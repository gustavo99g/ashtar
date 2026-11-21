/**
 * O recorte da foto de perfil: a imagem cobre um quadro redondo de `view` pixels, com zoom e
 * arrastada para os lados. O que fica dentro do quadro vira um quadrado de `OUTPUT` pixels.
 */

/** O lado da foto enviada, em pixels (o maior avatar da tela tem 72; 256 sobra para telas 2x). */
export const AVATAR_OUTPUT = 256;
export const ZOOM_MIN = 1;
export const ZOOM_MAX = 3;

export interface CropState {
	zoom: number;
	/** O deslocamento do centro da imagem em relação ao centro do quadro, em pixels da tela. */
	x: number;
	y: number;
}

/** A escala da imagem na tela: com zoom 1, o lado menor cobre o quadro. */
export function cropScale(
	width: number,
	height: number,
	view: number,
	zoom: number,
): number {
	return (view / Math.min(width, height)) * zoom;
}

/** Prende o zoom e o deslocamento para a imagem sempre cobrir o quadro inteiro. */
export function clampCrop(
	width: number,
	height: number,
	view: number,
	crop: CropState,
): CropState {
	const zoom = Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, crop.zoom));
	const scale = cropScale(width, height, view, zoom);
	const maxX = Math.max(0, (width * scale - view) / 2);
	const maxY = Math.max(0, (height * scale - view) / 2);
	return {
		zoom,
		x: Math.min(maxX, Math.max(-maxX, crop.x)),
		y: Math.min(maxY, Math.max(-maxY, crop.y)),
	};
}

/** O pedaço da imagem original (em pixels dela) que está dentro do quadro. */
export function cropSource(
	width: number,
	height: number,
	view: number,
	crop: CropState,
): { sx: number; sy: number; size: number } {
	const { zoom, x, y } = clampCrop(width, height, view, crop);
	const scale = cropScale(width, height, view, zoom);
	const size = view / scale;
	return {
		sx: width / 2 - x / scale - size / 2,
		sy: height / 2 - y / scale - size / 2,
		size,
	};
}
