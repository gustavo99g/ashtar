/**
 * A lateral direita: aberta ou minimizada, e qual aba. Fica no `localStorage` do app.
 *
 * Aberta ou minimizada é guardado por tipo de tela, porque o espaço vale diferente em cada uma: no
 * canal de texto ela começa aberta; na sala de voz, minimizada, para a grade e a transmissão não
 * perderem largura. A aba é uma só para as duas telas.
 */
import { create } from "zustand";
import { persist } from "zustand/middleware";

export type SideTab = "members" | "dms";

/** Em que tela a lateral está: um canal de texto ou a sala de voz. */
export type SideContext = "text" | "voice";

interface SidePanelState {
	openInText: boolean;
	openInVoice: boolean;
	tab: SideTab;
}

const DEFAULT: SidePanelState = {
	openInText: true,
	openInVoice: false,
	tab: "members",
};

function isTab(value: unknown): value is SideTab {
	return value === "members" || value === "dms";
}

export const useSidePanelStore = create<SidePanelState>()(
	persist(() => DEFAULT, {
		name: "ashtar-side-panel",
		version: 1,
		// Um valor estranho no disco volta para o padrão.
		merge: (persisted, current) => {
			const saved = persisted as Partial<SidePanelState> | undefined;
			return {
				...current,
				openInText:
					typeof saved?.openInText === "boolean"
						? saved.openInText
						: DEFAULT.openInText,
				openInVoice:
					typeof saved?.openInVoice === "boolean"
						? saved.openInVoice
						: DEFAULT.openInVoice,
				tab: isTab(saved?.tab) ? saved.tab : DEFAULT.tab,
			};
		},
	}),
);

const KEY = { text: "openInText", voice: "openInVoice" } as const;

/** Se a lateral está aberta nessa tela, e a aba. */
export function useSidePanel(context: SideContext): {
	open: boolean;
	tab: SideTab;
} {
	const open = useSidePanelStore((state) => state[KEY[context]]);
	const tab = useSidePanelStore((state) => state.tab);
	return { open, tab };
}

export function setSideOpen(context: SideContext, open: boolean): void {
	useSidePanelStore.setState({ [KEY[context]]: open });
}

export function setSideTab(tab: SideTab): void {
	useSidePanelStore.setState({ tab });
}

/** Abre a lateral dessa tela já numa aba: é o clique num ícone da faixa minimizada. */
export function openSideTab(context: SideContext, tab: SideTab): void {
	useSidePanelStore.setState({ [KEY[context]]: true, tab });
}
