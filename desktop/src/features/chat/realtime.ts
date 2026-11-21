/**
 * Os eventos do tempo real do chat: a mensagem nova, editada ou excluída, quem ficou online ou offline, quem entrou ou
 * saiu do grupo, e o `ready`. Todo `ready` traz quem está online; o da volta de uma queda
 * (`resumed`) também busca o que faltou.
 */
import type { QueryClient } from "@tanstack/react-query";
import type { Person, ServerEvent } from "@/lib/api";
import type { RealtimeEventInfo } from "@/lib/realtime";
import {
	appendMessages,
	catchUp,
	chatKeys,
	dropMessage,
	markAuthorRemoved,
	replaceMessage,
} from "./queries";
import { removePending } from "./stores/outboxStore";
import { forgetReplyTo } from "./stores/replyStore";
import { addTyping, clearTyping, resetTyping } from "./stores/typingStore";

function updatePeople(
	queryClient: QueryClient,
	change: (people: Person[]) => Person[],
): void {
	queryClient.setQueryData<Person[]>(chatKeys.people(), (people) =>
		people ? change(people) : people,
	);
}

export function handleChatRealtime(
	event: ServerEvent,
	queryClient: QueryClient,
	info: RealtimeEventInfo,
): void {
	switch (event.type) {
		case "message.created":
			appendMessages(queryClient, event.message.channel_id, [event.message]);
			// Se foi daqui, a caixa de saída já pode soltar (a resposta do POST pode chegar depois).
			removePending(event.message.client_id);
			// Quem mandou parou de digitar.
			clearTyping(event.message.channel_id, event.message.author.id);
			break;
		case "message.updated":
			replaceMessage(queryClient, event.message);
			break;
		case "message.deleted":
			dropMessage(queryClient, event.channel_id, event.message_id);
			forgetReplyTo(event.channel_id, event.message_id);
			break;
		case "typing":
			addTyping(event.channel_id, event.user_id);
			break;
		case "presence.changed":
			updatePeople(queryClient, (people) =>
				people.map((person) =>
					person.id === event.user_id
						? { ...person, online: event.online, status: event.status }
						: person,
				),
			);
			break;
		case "member.joined":
			updatePeople(queryClient, (people) =>
				people.some((person) => person.id === event.person.id)
					? people
					: [...people, event.person],
			);
			break;
		case "member.left":
			updatePeople(queryClient, (people) =>
				people.filter((person) => person.id !== event.user_id),
			);
			markAuthorRemoved(queryClient, event.user_id);
			break;
		case "ready": {
			// O que se digitava antes de o socket cair já não vale.
			resetTyping();
			const online = new Set(event.online);
			const busy = new Set(event.busy);
			const away = new Set(event.away);
			updatePeople(queryClient, (people) =>
				people.map((person) => ({
					...person,
					online: online.has(person.id),
					status: busy.has(person.id)
						? "busy"
						: away.has(person.id)
							? "away"
							: "available",
				})),
			);
			if (info.resumed) {
				// Quem entrou ou saiu do grupo no meio não veio por evento.
				void queryClient.invalidateQueries({ queryKey: chatKeys.people() });
				// As conversas privadas têm histórico em cache como os canais.
				void catchUp(queryClient, [...event.channels, ...event.dms]);
			}
			break;
		}
	}
}
