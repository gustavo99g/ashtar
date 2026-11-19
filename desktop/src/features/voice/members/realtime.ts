/**
 * Os eventos do tempo real que mudam a lista da sala vista de fora: a API manda a lista inteira
 * (`voice.participants`) sempre que alguém entra, sai ou liga a tela. E as ordens para a voz desta
 * pessoa (ADR 0026): ser movida de sala ou desconectada, que o `VoiceProvider` cumpre.
 */
import type { QueryClient } from "@tanstack/react-query";
import type { ServerEvent } from "@/lib/api";
import type { RealtimeEventInfo } from "@/lib/realtime";
import { setVoiceOrder } from "../room/stores/voiceOrderStore";
import { voiceKeys } from "./queries";

export function handleVoiceRealtime(
	event: ServerEvent,
	queryClient: QueryClient,
	info: RealtimeEventInfo,
): void {
	switch (event.type) {
		case "voice.participants":
			queryClient.setQueryData(
				voiceKeys.participants(event.channel_id),
				event.participants,
			);
			break;
		case "voice.moved":
			setVoiceOrder({
				kind: "move",
				channelId: event.channel_id,
				byName: event.by_name,
			});
			break;
		case "voice.disconnected":
			setVoiceOrder({ kind: "disconnect", byName: event.by_name });
			break;
		case "ready":
			// O que mudou enquanto o socket estava fora não veio por evento. No primeiro `ready`,
			// a lista acabou de ser buscada.
			if (info.resumed) {
				void queryClient.invalidateQueries({ queryKey: voiceKeys.all });
			}
			break;
	}
}
