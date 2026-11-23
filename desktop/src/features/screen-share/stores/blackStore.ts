/**
 * Se a própria transmissão está saindo preta agora (decisão 26 do plano da v0.8), para a faixa
 * "Saindo preta" do preview. Quem confere é o `BlackShareWatch`.
 */
import { create } from "zustand";

export const useBlackShare = create<{ black: boolean }>()(() => ({
	black: false,
}));

export function setShareBlack(black: boolean): void {
	useBlackShare.setState({ black });
}

export function useShareIsBlack(): boolean {
	return useBlackShare((state) => state.black);
}
