/** O `emojis.changed`: a lista nova, inteira, no store e no cache. */
import type { QueryClient } from "@tanstack/react-query";
import type { ServerEvent } from "@/lib/api";
import { emojisKeys } from "./queries";
import { setEmojis } from "./stores/emojiStore";

export function handleEmojisRealtime(
	event: ServerEvent,
	queryClient: QueryClient,
): void {
	if (event.type !== "emojis.changed") return;
	setEmojis(event.emojis);
	queryClient.setQueryData(emojisKeys.all(), event.emojis);
}
