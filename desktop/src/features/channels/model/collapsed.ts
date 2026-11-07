/**
 * O que uma categoria recolhida ainda mostra: o canal aberto, a sala em que a pessoa está e as
 * salas de voz com gente (só os avatares). O resto some até abrir de novo.
 */
import type { ChannelView } from "@/lib/api";

export interface CollapsedContext {
	/** O canal de texto aberto na tela. */
	openChannelId: string | null;
	/** A sala da chamada em andamento. */
	currentRoomId: string | null;
	/** Quantas pessoas há na sala (zero nos canais de texto). */
	people: number;
}

export function shownWhenCollapsed(
	channel: ChannelView,
	context: CollapsedContext,
): boolean {
	return (
		channel.id === context.openChannelId ||
		channel.id === context.currentRoomId ||
		(channel.kind === "voice" && context.people > 0)
	);
}

/** Quantos avatares a sala recolhida mostra antes do "+N". */
export const COLLAPSED_AVATARS = 5;
