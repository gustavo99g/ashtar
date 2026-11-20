/**
 * O nome de uma sala de voz pela lista de canais (ADR 0026): renomear a sala muda o nome em toda
 * tela na hora, porque a lista recarrega com o `channels.changed`.
 */
import { findChannel, useOptionalChannelLayout } from "@/features/channels";
import { fallbackRoomName } from "../model/channel";
import { useMaybeVoice } from "./useMaybeVoice";

export function useRoomName(id: string | null): string {
	const layout = useOptionalChannelLayout();
	if (id === null) return "";
	const channel = layout ? findChannel(layout, id) : undefined;
	return channel?.name ?? fallbackRoomName(id);
}

/** O nome da sala de voz em que a pessoa está; vazio fora de uma (ou numa ligação). */
export function useConnectedRoomName(): string {
	const voice = useMaybeVoice();
	return useRoomName(voice?.voiceKind === "room" ? voice.voiceChannelId : null);
}
