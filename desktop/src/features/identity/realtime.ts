/**
 * Os eventos do tempo real que mexem em quem está usando: o status. O `ready` traz o de agora a cada
 * conexão, e o `status.changed`, a troca feita em outro computador da mesma pessoa.
 */
import type { QueryClient } from "@tanstack/react-query";
import type { ServerEvent } from "@/lib/api";
import { setCachedStatus } from "./queries";

export function handleIdentityRealtime(
	event: ServerEvent,
	queryClient: QueryClient,
): void {
	switch (event.type) {
		case "ready":
		case "status.changed":
			setCachedStatus(queryClient, event.status);
			break;
	}
}
