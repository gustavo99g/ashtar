/**
 * O volume de cada pessoa, só para quem ajusta (ADR 0020): de 1 a 200 (%), e se ela está
 * silenciada. Vale para a voz dela, em qualquer sala. Fica no `localStorage` deste computador, por
 * id de pessoa; a API não sabe de nada. Sem som guarda o volume de antes, para o clique no
 * alto-falante voltar a ele; arrastar até o zero também tira o som.
 *
 * Só fica guardado quem saiu do padrão (100%, com som).
 */
import { create } from "zustand";
import { persist } from "zustand/middleware";

export interface UserVolume {
	/** De 1 a `MAX_USER_VOLUME`. O zero é `muted`, para o volume de antes não se perder. */
	volume: number;
	muted: boolean;
}

interface UserVolumeState {
	/** Por id de pessoa. Quem não está aqui está no padrão. */
	volumes: Record<string, UserVolume>;
}

/** O volume mais alto: 200%. */
export const MAX_USER_VOLUME = 200;

const DEFAULT: UserVolume = { volume: 100, muted: false };

function isDefault(value: UserVolume): boolean {
	return value.volume === DEFAULT.volume && !value.muted;
}

export const useUserVolumes = create<UserVolumeState>()(
	persist(() => ({ volumes: {} }) as UserVolumeState, {
		name: "ashtar-user-volume",
		version: 1,
		// Um valor estranho no disco é ignorado: a pessoa volta para o padrão.
		merge: (persisted, current) => {
			const saved = (persisted as Partial<UserVolumeState> | undefined)
				?.volumes;
			const volumes: Record<string, UserVolume> = {};
			if (saved && typeof saved === "object") {
				for (const [id, value] of Object.entries(saved)) {
					const volume = value?.volume;
					if (
						typeof volume !== "number" ||
						volume < 1 ||
						volume > MAX_USER_VOLUME
					)
						continue;
					const clean = {
						volume: Math.round(volume),
						muted: value.muted === true,
					};
					if (!isDefault(clean)) volumes[id] = clean;
				}
			}
			return { ...current, volumes };
		},
	}),
);

function write(userId: string, next: UserVolume): void {
	useUserVolumes.setState((state) => {
		const volumes = { ...state.volumes };
		if (isDefault(next)) delete volumes[userId];
		else volumes[userId] = next;
		return { volumes };
	});
}

/** O que a pessoa ouve de `userId`, de 0 a `MAX_USER_VOLUME`: zero sem som, 100 no padrão. */
export function heardVolume(state: UserVolumeState, userId: string): number {
	const saved = state.volumes[userId] ?? DEFAULT;
	return saved.muted ? 0 : saved.volume;
}

/** Do controle deslizante: zero tira o som (e guarda o volume de antes); o resto liga. */
export function setUserVolume(userId: string, value: number): void {
	const volume = Math.round(Math.min(MAX_USER_VOLUME, Math.max(0, value)));
	const before = useUserVolumes.getState().volumes[userId] ?? DEFAULT;
	write(
		userId,
		volume === 0 ? { ...before, muted: true } : { volume, muted: false },
	);
}

/** Do alto-falante: tira o som de `userId` só para você, ou volta ao volume de antes. */
export function toggleUserMuted(userId: string): void {
	const before = useUserVolumes.getState().volumes[userId] ?? DEFAULT;
	write(userId, { ...before, muted: !before.muted });
}

/** O volume de `userId` para quem usa este computador, de 0 a `MAX_USER_VOLUME`. */
export function useHeardVolume(userId: string): number {
	return useUserVolumes((state) => heardVolume(state, userId));
}
