/**
 * Onde a miniatura da transmissão fica: num dos seis encaixes da área do canal, os quatro cantos e
 * o meio de cada lateral. Arrastada, ela vai para o encaixe mais perto de onde foi solta.
 */

export type MiniCorner =
	| "top-left"
	| "top-right"
	| "left"
	| "right"
	| "bottom-left"
	| "bottom-right";

export const MINI_CORNERS: readonly MiniCorner[] = [
	"top-left",
	"top-right",
	"left",
	"right",
	"bottom-left",
	"bottom-right",
];

/** O tamanho da miniatura (16:9), em px. */
export const MINI_SIZE = { width: 320, height: 180 } as const;

/** A distância dos encaixes até a borda da área, em px (o `top-4`/`left-4` das classes). */
export const MINI_MARGIN = 16;

export function isMiniCorner(value: unknown): value is MiniCorner {
	return MINI_CORNERS.includes(value as MiniCorner);
}

/** O lado em que o encaixe fica: é por ele que a aba da miniatura recolhida sai. */
export function miniSide(corner: MiniCorner): "left" | "right" {
	return corner.endsWith("left") ? "left" : "right";
}

/**
 * O encaixe mais perto do centro da miniatura (`x`, `y`, dentro da área de `width` × `height`): a
 * metade da área em que o centro caiu, na horizontal, e o terço, na vertical (o de cima, o do meio
 * ou o de baixo).
 */
export function nearestCorner(
	center: { x: number; y: number },
	area: { width: number; height: number },
): MiniCorner {
	const horizontal = center.x < area.width / 2 ? "left" : "right";
	if (center.y < area.height / 3) return `top-${horizontal}`;
	if (center.y < (area.height * 2) / 3) return horizontal;
	return `bottom-${horizontal}`;
}

/** Onde fica o encaixe `corner` na área: o canto de cima, à esquerda, da miniatura encaixada. */
export function slotPosition(
	corner: MiniCorner,
	area: { width: number; height: number },
): { left: number; top: number } {
	const left =
		miniSide(corner) === "left"
			? MINI_MARGIN
			: area.width - MINI_SIZE.width - MINI_MARGIN;
	const top = corner.startsWith("top")
		? MINI_MARGIN
		: corner.startsWith("bottom")
			? area.height - MINI_SIZE.height - MINI_MARGIN
			: (area.height - MINI_SIZE.height) / 2;
	return { left, top };
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
