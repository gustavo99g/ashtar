import type { WindowInput } from "@/lib/tauri/commands";

/*
 * A tecla ou o botão de um evento da janela, no formato do gancho do Rust (`shortcuts/combo.rs`).
 * No Windows, o `keyCode` do WebView2 já é o código virtual (`VK_*`); os modificadores chegam
 * genéricos (Ctrl é 17) e o lado vem do `location`, como o gancho dá (o Ctrl esquerdo é 0xA2).
 */

const RIGHT = 2;

/** O Shift, o Ctrl e o Alt: o código do lado esquerdo e o do direito. */
const SIDED: Record<number, [number, number]> = {
	16: [0xa0, 0xa1],
	17: [0xa2, 0xa3],
	18: [0xa4, 0xa5],
};

export function keyInput(event: {
	keyCode: number;
	location: number;
}): WindowInput | null {
	const { keyCode, location } = event;
	if (keyCode <= 0 || keyCode > 0xfe) return null;
	const sided = SIDED[keyCode];
	if (sided) return { key: location === RIGHT ? sided[1] : sided[0], mouse: null };
	// A tecla do Windows: 91 é a esquerda, 92 a direita.
	if (keyCode === 91 && location === RIGHT) return { key: 0x5c, mouse: null };
	return { key: keyCode, mouse: null };
}

/** Só os botões que podem ser atalho: o do meio e os laterais. */
export function mouseInput(button: number): WindowInput | null {
	switch (button) {
		case 1:
			return { key: null, mouse: "middle" };
		case 3:
			return { key: null, mouse: "x1" };
		case 4:
			return { key: null, mouse: "x2" };
		default:
			return null;
	}
}

