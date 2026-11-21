/**
 * Os eventos do tempo real das conversas privadas. O histórico não é daqui: o `message.created` de
 * uma conversa entra no cache de mensagens pelo `features/chat`, como o de um canal. Aqui é só a
 * lista de conversas.
 */
import type { QueryClient } from "@tanstack/react-query";
import { channelsKeys, findChannel } from "@/features/channels";
import type { Conversation, Layout, ServerEvent } from "@/lib/api";
import type { RealtimeEventInfo } from "@/lib/realtime";
import { dmsKeys, touchConversation } from "./queries";

export function handleDmsRealtime(
	event: ServerEvent,
	queryClient: QueryClient,
	info: RealtimeEventInfo,
): void {
	switch (event.type) {
		case "message.created": {
			if (touchConversation(queryClient, event.message)) return;
			// Não é de uma conversa conhecida. Se é de um canal da árvore, não é daqui; senão, é a
			// primeira mensagem de uma conversa nova (alguém escreveu para mim): busca a lista.
			const layout = queryClient.getQueryData<Layout>(channelsKeys.layout());
			if (layout && findChannel(layout, event.message.channel_id)) return;
			void queryClient.invalidateQueries({ queryKey: dmsKeys.list() });
			break;
		}
		case "message.updated":
		case "message.deleted":
			// O resumo da conversa mostra a última mensagem: se foi ela que mudou, busca a lista.
			if (
				queryClient
					.getQueryData<Conversation[]>(dmsKeys.list())
					?.some(
						(c) =>
							c.last_message?.id ===
							(event.type === "message.updated"
								? event.message.id
								: event.message_id),
					)
			) {
				void queryClient.invalidateQueries({ queryKey: dmsKeys.list() });
			}
			break;
		case "user.updated":
		case "member.left":
			// A conversa com quem saiu fica só para leitura: a lista traz o `removed`. O nome novo
			// de alguém também vem na lista.
			void queryClient.invalidateQueries({ queryKey: dmsKeys.list() });
			break;
		case "ready":
			// Na volta de uma queda, o que chegou nas conversas no meio não veio por evento.
			if (info.resumed) {
				void queryClient.invalidateQueries({ queryKey: dmsKeys.list() });
			}
			break;
	}
}
