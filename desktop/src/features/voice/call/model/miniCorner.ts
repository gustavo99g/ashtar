/**
 * Onde a miniatura da transmissão fica: num dos quatro cantos da área do canal. Arrastada, ela
 * vai para o canto mais perto de onde foi solta.
 */

export type MiniCorner =
	| "top-left"
	| "top-right"
	| "bottom-left"
	| "bottom-right";

export const MINI_CORNERS: readonly MiniCorner[] = [
	"top-left",
	"top-right",
	"bottom-left",
	"bottom-right",
];

/** O tamanho da miniatura (16:9), em px. */
export const MINI_SIZE = { width: 320, height: 180 } as const;

export function isMiniCorner(value: unknown): value is MiniCorner {
	return MINI_CORNERS.includes(value as MiniCorner);
}

/**
 * O canto mais perto do centro da miniatura (`x`, `y`, dentro da área de `width` × `height`): a
 * metade da área em que o centro caiu, na vertical e na horizontal.
 */
export function nearestCorner(
	center: { x: number; y: number },
	area: { width: number; height: number },
): MiniCorner {
	const vertical = center.y < area.height / 2 ? "top" : "bottom";
	const horizontal = center.x < area.width / 2 ? "left" : "right";
	return `${vertical}-${horizontal}`;
}

/** Onde a miniatura fica enquanto arrasta: dentro da área, sem sair pelas bordas. */
export function clampToArea(
	position: { left: number; top: number },
	area: { width: number; height: number },
): { left: number; top: number } {
	return {
		left: Math.min(
			Math.max(0, position.left),
			Math.max(0, area.width - MINI_SIZE.width),
		),
		top: Math.min(
			Math.max(0, position.top),
			Math.max(0, area.height - MINI_SIZE.height),
		),
	};
}
