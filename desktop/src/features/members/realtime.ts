/**
 * Os eventos do tempo real que mudam a lista do Painel: alguém entrou no grupo ou foi removido. A
 * lista do Painel tem campos que o evento não traz (computador, convite), então busca de novo. A
 * volta de uma queda (`ready` com `resumed`) também, porque o que mudou no meio não veio por evento.
 */
import type { QueryClient } from "@tanstack/react-query";
import type { ServerEvent } from "@/lib/api";
import type { RealtimeEventInfo } from "@/lib/realtime";
import { membersKeys } from "./queries";

export function handleMembersRealtime(
	event: ServerEvent,
	queryClient: QueryClient,
	info: RealtimeEventInfo,
): void {
	const stale =
		event.type === "member.joined" ||
		event.type === "member.left" ||
		event.type === "user.updated" ||
		(event.type === "ready" && info.resumed);
	if (stale) {
		void queryClient.invalidateQueries({ queryKey: membersKeys.list() });
	}
}
