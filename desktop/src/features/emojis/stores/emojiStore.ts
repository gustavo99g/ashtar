/**
 * Os emojis do grupo na memória: a lista do `GET /api/emojis`, trocada inteira a cada
 * `emojis.changed`. Fica num store (e não só no cache do TanStack) porque o texto das mensagens, as
 * reações e o seletor leem daqui, e nem todo lugar que desenha uma mensagem tem o `QueryClient`.
 */
import { create } from "zustand";
import type { Emoji } from "@/lib/api";

interface EmojiState {
	/** `null` até a primeira lista chegar. */
	emojis: Emoji[] | null;
	byName: Map<string, Emoji>;
	byId: Map<string, Emoji>;
}

const EMPTY: EmojiState = { emojis: null, byName: new Map(), byId: new Map() };

export const useEmojiStore = create<EmojiState>()(() => EMPTY);

export function setEmojis(emojis: Emoji[]): void {
	useEmojiStore.setState({
		emojis,
		byName: new Map(emojis.map((emoji) => [emoji.name, emoji])),
		byId: new Map(emojis.map((emoji) => [emoji.id, emoji])),
	});
}

export function clearEmojis(): void {
	useEmojiStore.setState(EMPTY);
}

const NONE: Emoji[] = [];

/** Todos, por nome (vazio até carregar). */
export function useGroupEmojis(): Emoji[] {
	return useEmojiStore((state) => state.emojis ?? NONE);
}

export function useEmojiByName(): Map<string, Emoji> {
	return useEmojiStore((state) => state.byName);
}

export function useEmojiById(): Map<string, Emoji> {
	return useEmojiStore((state) => state.byId);
}

/** O emoji de uma reação `c:<id>`; `undefined` para o Unicode ou um que foi excluído. */
export function customId(reaction: string): string | null {
	return reaction.startsWith("c:") ? reaction.slice(2) : null;
}
