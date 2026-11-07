/**
 * O volume da transmissão que a pessoa assiste no Foco, de 1 a 100 (%), e se está sem som. Fica no
 * `localStorage` do app: vale para a próxima transmissão e para a próxima abertura. Sem som guarda
 * o volume de antes, para o clique no ícone voltar a ele; arrastar até o zero também tira o som.
 */
import { create } from "zustand";
import { persist } from "zustand/middleware";

interface ShareVolumeState {
	/** De 1 a 100. O zero é `muted`, para o volume de antes não se perder. */
	volume: number;
	muted: boolean;
}

const DEFAULT: ShareVolumeState = { volume: 100, muted: false };

export const useShareVolume = create<ShareVolumeState>()(
	persist(() => DEFAULT, {
		name: "ashtar-share-volume",
		version: 1,
		// Um valor estranho no disco volta para o padrão.
		merge: (persisted, current) => {
			const saved = persisted as Partial<ShareVolumeState> | undefined;
			const volume = saved?.volume;
			return {
				...current,
				volume:
					typeof volume === "number" && volume >= 1 && volume <= 100
						? Math.round(volume)
						: DEFAULT.volume,
				muted: saved?.muted === true,
			};
		},
	}),
);

/** O que a pessoa ouve, de 0 a 100: zero sem som. */
export function audibleVolume(state: ShareVolumeState): number {
	return state.muted ? 0 : state.volume;
}

/** Do controle deslizante: zero tira o som (e guarda o volume de antes); o resto liga. */
export function setShareVolume(value: number): void {
	const volume = Math.round(Math.min(100, Math.max(0, value)));
	useShareVolume.setState(
		volume === 0 ? { muted: true } : { volume, muted: false },
	);
}

/** Do ícone: tira o som, ou volta ao volume de antes. */
export function toggleShareMuted(): void {
	useShareVolume.setState((state) => ({ muted: !state.muted }));
}
