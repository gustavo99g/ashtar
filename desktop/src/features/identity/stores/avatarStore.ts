/**
 * A foto de perfil de cada pessoa, pelo nick (ADR 0031). O `Avatar` é desenhado em muitos lugares
 * que só têm o nick à mão (a sala de voz, as notificações, a lista de membros); aqui fica o id do
 * arquivo da foto de cada um, para todos esses lugares mostrarem a mesma foto sem passar o id.
 *
 * Quem alimenta: a lista de pessoas (`GET /api/people`), o `/api/me` e o `user.updated`, que chega
 * quando alguém troca a foto ou o nome.
 */
import { create } from "zustand";

interface AvatarState {
	/** O id do arquivo da foto, pelo nick em minúsculas; `null` é "sem foto". */
	byNick: Record<string, string | null>;
	/** O nick de cada id, para o `user.updated`, que só traz o id. */
	nickById: Record<string, string>;
}

export const useAvatarStore = create<AvatarState>(() => ({
	byNick: {},
	nickById: {},
}));

interface WithAvatar {
	id: string;
	nick: string;
	avatar?: string | null;
}

/** Guarda a foto de cada pessoa da lista (a que já estava, se a lista não diz). */
export function rememberAvatars(people: readonly WithAvatar[]): void {
	useAvatarStore.setState((state) => {
		const byNick = { ...state.byNick };
		const nickById = { ...state.nickById };
		let changed = false;
		for (const person of people) {
			const key = person.nick.toLowerCase();
			if (nickById[person.id] !== key) {
				nickById[person.id] = key;
				changed = true;
			}
			if (person.avatar !== undefined && byNick[key] !== person.avatar) {
				byNick[key] = person.avatar;
				changed = true;
			}
		}
		return changed ? { byNick, nickById } : state;
	});
}

/** A foto nova de `id` (o `user.updated`). Sem o nick conhecido, não há onde mostrar. */
export function setAvatarOf(id: string, avatar: string | null): void {
	useAvatarStore.setState((state) => {
		const key = state.nickById[id];
		if (!key || state.byNick[key] === avatar) return state;
		return { byNick: { ...state.byNick, [key]: avatar } };
	});
}

/** O id da foto de quem tem o `nick`, ou `null`. */
export function useAvatarOf(nick: string): string | null {
	return useAvatarStore((state) => state.byNick[nick.toLowerCase()] ?? null);
}

/** Esquece tudo (ao sair da conta). */
export function clearAvatars(): void {
	useAvatarStore.setState({ byNick: {}, nickById: {} });
}
