/**
 * O encaixe da miniatura da transmissão e se ela está recolhida. Ficam no `localStorage` do app:
 * a miniatura volta do mesmo jeito na próxima transmissão e na próxima abertura.
 */
import { create } from "zustand";
import { persist } from "zustand/middleware";
import { isMiniCorner, type MiniCorner } from "../model/miniCorner";

interface MiniShareState {
	corner: MiniCorner;
	/** Recolhida: vira uma aba presa na lateral, e o canal fica livre. */
	collapsed: boolean;
}

const DEFAULT: MiniShareState = { corner: "bottom-right", collapsed: false };

export const useMiniShare = create<MiniShareState>()(
	persist(() => DEFAULT, {
		name: "ashtar-mini-share",
		version: 1,
		// Um valor estranho no disco volta para o padrão.
		merge: (persisted, current) => {
			const saved = persisted as Partial<MiniShareState> | undefined;
			return {
				...current,
				corner: isMiniCorner(saved?.corner) ? saved.corner : DEFAULT.corner,
				collapsed:
					typeof saved?.collapsed === "boolean"
						? saved.collapsed
						: DEFAULT.collapsed,
			};
		},
	}),
);

export function setMiniCorner(corner: MiniCorner): void {
	useMiniShare.setState({ corner });
}

export function setMiniCollapsed(collapsed: boolean): void {
	useMiniShare.setState({ collapsed });
}
