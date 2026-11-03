/**
 * O canto da miniatura da transmissão. Fica no `localStorage` do app: a miniatura volta para o
 * mesmo canto na próxima transmissão e na próxima abertura.
 */
import { create } from "zustand";
import { persist } from "zustand/middleware";
import { isMiniCorner, type MiniCorner } from "../model/miniCorner";

interface MiniShareState {
	corner: MiniCorner;
}

const DEFAULT: MiniShareState = { corner: "bottom-right" };

export const useMiniShare = create<MiniShareState>()(
	persist(() => DEFAULT, {
		name: "ashtar-mini-share",
		version: 1,
		// Um canto estranho no disco volta para o padrão.
		merge: (persisted, current) => {
			const corner = (persisted as Partial<MiniShareState> | undefined)?.corner;
			return {
				...current,
				corner: isMiniCorner(corner) ? corner : DEFAULT.corner,
			};
		},
	}),
);

export function setMiniCorner(corner: MiniCorner): void {
	useMiniShare.setState({ corner });
}
