/**
 * O volume e a qualidade de cada transmissão, por quem transmite (ADR 0024). Volume de 1 a 200 (%),
 * e se está sem som; acima de 100% o som ganha reforço (`useShareAudio`), para uma transmissão que
 * chega baixa. A qualidade é Automática (a camada segue o tamanho) ou Leve (sempre a camada leve).
 *
 * Fica no `localStorage` do app: vale para a próxima transmissão da mesma pessoa e para a próxima
 * abertura. Quem ainda não tem ajuste próprio começa no `fallback`, que é o último volume escolhido
 * (e, para quem vem da 0.3, o volume único de antes). Sem som guarda o volume de antes, para o
 * clique no ícone voltar a ele; arrastar até o zero também tira o som.
 */
import { create } from "zustand";
import { persist } from "zustand/middleware";

export type ShareQuality = "auto" | "lite";

export interface ShareSettings {
	/** De 1 a `MAX_SHARE_VOLUME`. O zero é `muted`, para o volume de antes não se perder. */
	volume: number;
	muted: boolean;
	quality: ShareQuality;
}

interface ShareVolumeState {
	/** Por id de quem transmite. */
	byOwner: Record<string, ShareSettings>;
	/** O volume de quem ainda não tem ajuste próprio. */
	fallback: { volume: number; muted: boolean };
}

/** O volume mais alto: 200%. */
export const MAX_SHARE_VOLUME = 200;

const DEFAULT_VOLUME = { volume: 100, muted: false };

function validVolume(value: unknown): number | null {
	return typeof value === "number" && value >= 1 && value <= MAX_SHARE_VOLUME
		? Math.round(value)
		: null;
}

function readSettings(value: unknown): ShareSettings | null {
	if (typeof value !== "object" || value === null) return null;
	const { volume, muted, quality } = value as Record<string, unknown>;
	const valid = validVolume(volume);
	if (valid === null) return null;
	return {
		volume: valid,
		muted: muted === true,
		quality: quality === "lite" ? "lite" : "auto",
	};
}

export const useShareVolume = create<ShareVolumeState>()(
	persist(
		() =>
			({ byOwner: {}, fallback: DEFAULT_VOLUME }) as ShareVolumeState,
		{
			name: "ashtar-share-volume",
			version: 2,
			// A 0.3 guardava um volume só: ele vira o de quem ainda não tem ajuste.
			migrate: (persisted, version) => {
				if (version < 2) {
					const old = persisted as { volume?: unknown; muted?: unknown };
					return { byOwner: {}, fallback: old } as unknown as ShareVolumeState;
				}
				return persisted as ShareVolumeState;
			},
			// Um valor estranho no disco volta para o padrão.
			merge: (persisted, current) => {
				const saved = persisted as Partial<ShareVolumeState> | undefined;
				const byOwner: Record<string, ShareSettings> = {};
				if (typeof saved?.byOwner === "object" && saved.byOwner !== null) {
					for (const [id, value] of Object.entries(saved.byOwner)) {
						const settings = readSettings(value);
						if (settings) byOwner[id] = settings;
					}
				}
				const fallback = saved?.fallback as
					| { volume?: unknown; muted?: unknown }
					| undefined;
				const volume = validVolume(fallback?.volume);
				return {
					...current,
					byOwner,
					fallback:
						volume === null
							? DEFAULT_VOLUME
							: { volume, muted: fallback?.muted === true },
				};
			},
		},
	),
);

/** Os ajustes da transmissão de `owner`, ou o padrão de quem ainda não tem. */
export function shareSettingsOf(
	state: ShareVolumeState,
	owner: string,
): ShareSettings {
	return state.byOwner[owner] ?? { ...state.fallback, quality: "auto" };
}

/** O que a pessoa ouve da transmissão de `owner`, de 0 a `MAX_SHARE_VOLUME`: zero sem som. */
export function audibleVolume(state: ShareVolumeState, owner: string): number {
	const settings = shareSettingsOf(state, owner);
	return settings.muted ? 0 : settings.volume;
}

function update(owner: string, change: Partial<ShareSettings>): void {
	useShareVolume.setState((state) => {
		const next = { ...shareSettingsOf(state, owner), ...change };
		return {
			byOwner: { ...state.byOwner, [owner]: next },
			// O último volume escolhido vale para quem ainda não tem ajuste; o sem som, não.
			fallback:
				"volume" in change && !next.muted
					? { volume: next.volume, muted: false }
					: state.fallback,
		};
	});
}

/** Do controle deslizante: zero tira o som (e guarda o volume de antes); o resto liga. */
export function setShareVolume(owner: string, value: number): void {
	const volume = Math.round(Math.min(MAX_SHARE_VOLUME, Math.max(0, value)));
	update(owner, volume === 0 ? { muted: true } : { volume, muted: false });
}

/** Do ícone: tira o som, ou volta ao volume de antes. */
export function toggleShareMuted(owner: string): void {
	const state = useShareVolume.getState();
	update(owner, { muted: !shareSettingsOf(state, owner).muted });
}

/** Automática ou Leve, para a transmissão de `owner`. */
export function setShareQuality(owner: string, quality: ShareQuality): void {
	update(owner, { quality });
}
