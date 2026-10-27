/**
 * Se o seletor de fonte está aberto. Um store, e não um estado de componente, porque mais de um
 * lugar abre o mesmo seletor: o botão Tela da barra da sala, o do painel "Voz conectada" e a ação
 * de um aviso ("Compartilhar outra"), que roda fora da árvore do React.
 */
import { create } from "zustand";

export const usePickerStore = create<{ open: boolean }>()(() => ({
	open: false,
}));

export function openSourcePicker(): void {
	usePickerStore.setState({ open: true });
}

export function closeSourcePicker(): void {
	usePickerStore.setState({ open: false });
}
