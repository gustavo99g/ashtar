/**
 * As conversas privadas abertas embaixo da tela: quais são e qual está expandida. Fica no
 * `localStorage` do app, por computador: abrir o app de novo traz as mesmas janelas.
 *
 * `open` vai da mais recente para a mais antiga. `active` é a expandida, ou `null` com todas
 * minimizadas. O que cabe na tela quem decide é o `DmDock`.
 */
import { create } from "zustand";
import { persist } from "zustand/middleware";

/** Quantas conversas ficam abertas ao mesmo tempo. Abrir mais uma fecha a mais antiga. */
export const MAX_OPEN = 8;

interface OpenDmsState {
	open: string[];
	active: string | null;
}

const DEFAULT: OpenDmsState = { open: [], active: null };

export const useOpenDms = create<OpenDmsState>()(
	persist(() => DEFAULT, {
		name: "ashtar-open-dms",
		version: 1,
		// Um valor estranho no disco volta para o padrão.
		merge: (persisted, current) => {
			const saved = persisted as Partial<OpenDmsState> | undefined;
			const open = Array.isArray(saved?.open)
				? saved.open
						.filter((id): id is string => typeof id === "string")
						.slice(0, MAX_OPEN)
				: DEFAULT.open;
			const active =
				typeof saved?.active === "string" && open.includes(saved.active)
					? saved.active
					: null;
			return { ...current, open, active };
		},
	}),
);

/** Abre a conversa expandida, ou expande a que já estava aberta. Ela vai para a frente da fila. */
export function showDm(id: string): void {
	useOpenDms.setState((state) => ({
		open: [id, ...state.open.filter((other) => other !== id)].slice(
			0,
			MAX_OPEN,
		),
		active: id,
	}));
}

/** Minimiza a expandida: ela continua aberta, como aba. */
export function minimizeDm(): void {
	useOpenDms.setState({ active: null });
}

export function closeDm(id: string): void {
	useOpenDms.setState((state) => ({
		open: state.open.filter((other) => other !== id),
		active: state.active === id ? null : state.active,
	}));
}

/** Fecha tudo: ao sair da conta. */
export function clearOpenDms(): void {
	useOpenDms.setState(DEFAULT);
}
