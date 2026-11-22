/**
 * Quem está digitando em cada canal e conversa (ADR 0027), pelo `typing` do tempo real. Cada
 * entrada some 6 segundos depois do último aviso (o app de quem digita repete de 3 em 3), ou na hora
 * em que chega a mensagem da pessoa.
 */
import { create } from "zustand";

/** Sem outro aviso por tanto tempo, a pessoa parou de digitar. */
export const TYPING_TTL_MS = 6_000;

interface TypingState {
	/** Por canal, os ids de quem digita, na ordem em que começaram. */
	byChannel: Record<string, readonly string[]>;
}

export const useTypingStore = create<TypingState>()(() => ({ byChannel: {} }));

const timers = new Map<string, ReturnType<typeof setTimeout>>();
const NOBODY: readonly string[] = [];

function key(channelId: string, userId: string) {
	return `${channelId}\u0000${userId}`;
}

export function clearTyping(channelId: string, userId: string): void {
	const k = key(channelId, userId);
	clearTimeout(timers.get(k));
	timers.delete(k);
	useTypingStore.setState((state) => {
		const ids = state.byChannel[channelId];
		if (!ids?.includes(userId)) return state;
		const rest = ids.filter((id) => id !== userId);
		const byChannel = { ...state.byChannel };
		if (rest.length === 0) delete byChannel[channelId];
		else byChannel[channelId] = rest;
		return { byChannel };
	});
}

export function addTyping(channelId: string, userId: string): void {
	const k = key(channelId, userId);
	clearTimeout(timers.get(k));
	timers.set(
		k,
		setTimeout(() => clearTyping(channelId, userId), TYPING_TTL_MS),
	);
	useTypingStore.setState((state) => {
		const ids = state.byChannel[channelId] ?? NOBODY;
		if (ids.includes(userId)) return state;
		return { byChannel: { ...state.byChannel, [channelId]: [...ids, userId] } };
	});
}

/** Esquece tudo (a sessão terminou, ou o socket caiu e voltou). */
export function resetTyping(): void {
	for (const timer of timers.values()) clearTimeout(timer);
	timers.clear();
	useTypingStore.setState({ byChannel: {} });
}

/** Quem está digitando em `channelId` agora. */
export function useTyping(channelId: string): readonly string[] {
	return useTypingStore((state) => state.byChannel[channelId] ?? NOBODY);
}

/** A linha embaixo do campo: "ana está digitando…", "ana e bia estão…", "várias pessoas…". */
export function typingLabel(names: readonly string[]): string | null {
	if (names.length === 0) return null;
	if (names.length === 1) return `${names[0]} está digitando…`;
	if (names.length === 2) return `${names[0]} e ${names[1]} estão digitando…`;
	return "várias pessoas estão digitando…";
}
