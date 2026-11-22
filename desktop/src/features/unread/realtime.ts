/**
 * Os eventos do tempo real que mexem nas não lidas. Não toca no cache da API: as não lidas moram no
 * `store.ts`.
 */
import type { ServerEvent } from "@/lib/api";
import {
	applyState,
	countMessage,
	countNewMention,
	seedFromReady,
} from "./store";

export function handleUnreadRealtime(event: ServerEvent): void {
	switch (event.type) {
		case "ready":
			seedFromReady(event.user_id, [...event.channels, ...event.dms]);
			break;
		case "message.created":
			countMessage(event.message);
			break;
		case "message.updated":
			countNewMention(event.message, event.new_mentions);
			break;
		case "channel.state":
			applyState(event.channel_id, event.state);
			break;
	}
}
