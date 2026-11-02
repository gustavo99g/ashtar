/**
 * Leituras da lista de canais que mais de uma tela faz.
 */
import type { ChannelView, Layout } from "@/lib/api";

/** Todos os canais abertos, na ordem da lista: o topo e depois cada categoria. */
export function allChannels(layout: Layout): ChannelView[] {
	return [...layout.top, ...layout.categories.flatMap((c) => c.channels)];
}

/** Os canais de texto abertos, na ordem da lista. */
export function textChannels(layout: Layout): ChannelView[] {
	return allChannels(layout).filter((channel) => channel.kind === "text");
}

/** O canal aberto com esse id, ou `undefined` (arquivado, ou que não existe). */
export function findChannel(
	layout: Layout,
	id: string,
): ChannelView | undefined {
	return allChannels(layout).find((channel) => channel.id === id);
}

/** O `#geral` e a Sala não se arquivam (a API recusa; o menu nem oferece). */
const PROTECTED = new Set(["geral", "sala"]);

export function canArchive(channel: ChannelView): boolean {
	return !PROTECTED.has(channel.id);
}
