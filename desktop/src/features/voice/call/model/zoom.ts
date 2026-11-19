/**
 * Ampliar a transmissão em foco (ADR 0024): a escala, de 1× a 4×, e o deslocamento da imagem, a
 * partir da roda e do arrasto. O bloco aplica `translate(x, y) scale(scale)` com a origem no centro,
 * então o deslocamento é em pixels do bloco, e fica preso para a imagem ampliada nunca deixar borda
 * vazia.
 */

export interface Zoom {
	scale: number;
	x: number;
	y: number;
}

export interface Size {
	width: number;
	height: number;
}

export const MIN_ZOOM = 1;
export const MAX_ZOOM = 4;

export const NO_ZOOM: Zoom = { scale: 1, x: 0, y: 0 };

/** Quanto cada pixel da roda amplia: uma volta comum (100) dá uns 22%. */
const WHEEL_STEP = 0.002;

function clamp(value: number, min: number, max: number): number {
	return Math.min(max, Math.max(min, value));
}

/** O deslocamento preso: com `scale`, a imagem sobra `(scale - 1) / 2` do bloco para cada lado. */
export function clampZoom(zoom: Zoom, size: Size): Zoom {
	const scale = clamp(zoom.scale, MIN_ZOOM, MAX_ZOOM);
	const maxX = (size.width * (scale - 1)) / 2;
	const maxY = (size.height * (scale - 1)) / 2;
	return {
		scale,
		// `+ 0` tira o -0, que só confunde quem compara.
		x: clamp(zoom.x, -maxX, maxX) + 0,
		y: clamp(zoom.y, -maxY, maxY) + 0,
	};
}

/**
 * Amplia (ou reduz) por `factor` mantendo parado o ponto `point` (em pixels a partir do centro do
 * bloco): o que está sob o mouse continua sob o mouse.
 */
export function zoomAt(
	zoom: Zoom,
	factor: number,
	point: { x: number; y: number },
	size: Size,
): Zoom {
	const scale = clamp(zoom.scale * factor, MIN_ZOOM, MAX_ZOOM);
	const ratio = scale / zoom.scale;
	return clampZoom(
		{
			scale,
			x: point.x - (point.x - zoom.x) * ratio,
			y: point.y - (point.y - zoom.y) * ratio,
		},
		size,
	);
}

/** O fator de um giro da roda: para cima amplia, para baixo reduz. */
export function wheelFactor(deltaY: number): number {
	return Math.exp(-deltaY * WHEEL_STEP);
}

/** Arrasta a imagem ampliada. */
export function panBy(zoom: Zoom, dx: number, dy: number, size: Size): Zoom {
	return clampZoom({ ...zoom, x: zoom.x + dx, y: zoom.y + dy }, size);
}

export function isZoomed(zoom: Zoom): boolean {
	return zoom.scale > MIN_ZOOM;
}

/** "2,5×", para o botão que volta ao 1×. */
export function zoomLabel(zoom: Zoom): string {
	const rounded = Math.round(zoom.scale * 10) / 10;
	return `${String(rounded).replace(".", ",")}×`;
}

export function zoomTransform(zoom: Zoom): string | undefined {
	if (!isZoomed(zoom)) return undefined;
	return `translate(${zoom.x}px, ${zoom.y}px) scale(${zoom.scale})`;
}
