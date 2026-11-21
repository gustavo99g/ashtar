/**
 * Os eventos do tempo real que mexem em quem está usando: o status, a foto e o nome. O `ready` traz
 * o status de agora a cada conexão, e o `status.changed`, a troca feita em outro computador da mesma
 * pessoa. O `user.updated` traz a foto ou o nome novo de alguém (talvez eu mesmo, em outro
 * computador).
 */
import type { QueryClient } from "@tanstack/react-query";
import type { MeResponse, ServerEvent } from "@/lib/api";
import { identityKeys, setCachedStatus } from "./queries";
import { setAvatarOf } from "./stores/avatarStore";

export function handleIdentityRealtime(
	event: ServerEvent,
	queryClient: QueryClient,
): void {
	switch (event.type) {
		case "ready":
		case "status.changed":
			setCachedStatus(queryClient, event.status);
			break;
		case "user.updated":
			setAvatarOf(event.id, event.avatar);
			queryClient.setQueryData<MeResponse>(identityKeys.me(), (me) =>
				me && me.user.id === event.id
					? {
							...me,
							user: {
								...me.user,
								display_name: event.display_name,
								avatar: event.avatar,
							},
						}
					: me,
			);
			break;
	}
}
