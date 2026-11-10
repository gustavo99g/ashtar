import { Children, type ReactNode } from "react";

/*
 * A Grade da sala. As colunas se ajustam à largura da janela (`auto-fit`, de 280 px até dividir o
 * espaço), e cada lugar mantém a proporção 16:9. A largura máxima acompanha o número de lugares
 * (360 px cada, o tamanho do quadro): numa tela grande, poucos lugares ficam no meio, do tamanho
 * do quadro, em vez de esticar de lado a lado.
 */

const TILE_MAX = 360;
const GAP = 12;
const PADDING = 24;

export function RoomGrid({ children }: { children: ReactNode }) {
	const count = Math.max(1, Children.toArray(children).length);
	return (
		<div
			className="mx-auto grid w-full flex-1 grid-cols-[repeat(auto-fit,minmax(280px,1fr))] content-center gap-3 p-6"
			style={{ maxWidth: count * TILE_MAX + (count - 1) * GAP + 2 * PADDING }}
		>
			{children}
		</div>
	);
}
