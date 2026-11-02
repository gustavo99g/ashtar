/**
 * O `channels.changed`: alguém mudou a lista. Se a versão é mais nova que a do cache, busca de
 * novo; a do próprio `PUT` (Etapa 7) já chega com a mesma versão e não busca. Na volta de uma
 * queda (`ready` com `resumed`), busca também: o que mudou no meio não veio por evento.
 */
import type { QueryClient } from "@tanstack/react-query";
import type { Layout, ServerEvent } from "@/lib/api";
import type { RealtimeEventInfo } from "@/lib/realtime";
import { channelsKeys } from "./queries";

export function handleChannelsRealtime(
	event: ServerEvent,
	queryClient: QueryClient,
	info: RealtimeEventInfo,
): void {
	if (event.type === "ready") {
		if (info.resumed) {
			void queryClient.invalidateQueries({ queryKey: channelsKeys.layout() });
		}
		return;
	}
	if (event.type !== "channels.changed") return;
	const cached = queryClient.getQueryData<Layout>(channelsKeys.layout());
	if (cached && cached.version >= event.version) return;
	void queryClient.invalidateQueries({ queryKey: channelsKeys.layout() });
}
