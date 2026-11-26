/**
 * Os eventos do soundboard (v0.9): a lista nova dos aprovados (`sounds.changed`), o tamanho da fila
 * (`sounds.queue`), o aviso a quem enviou (`sounds.reviewed`) e alguém tocando um som
 * (`voice.sound_played`), que vai para o tocador da voz.
 */
import type { QueryClient } from "@tanstack/react-query";
import { toast } from "@/components/ui/toast";
import type { ServerEvent } from "@/lib/api";
import type { RealtimeEventInfo } from "@/lib/realtime";
import { emitSoundPlayed } from "./model/played";
import { soundsKeys } from "./queries";
import { setPendingSounds, setSounds } from "./stores/soundsStore";

export function handleSoundsRealtime(
	event: ServerEvent,
	queryClient: QueryClient,
	info: RealtimeEventInfo,
): void {
	switch (event.type) {
		case "sounds.changed":
			setSounds(event.sounds);
			queryClient.setQueryData(soundsKeys.approved(), event.sounds);
			void queryClient.invalidateQueries({ queryKey: soundsKeys.history() });
			break;
		case "sounds.queue":
			setPendingSounds(event.pending);
			void queryClient.invalidateQueries({ queryKey: soundsKeys.pending() });
			void queryClient.invalidateQueries({ queryKey: soundsKeys.history() });
			break;
		case "sounds.reviewed": {
			const { sound } = event;
			void queryClient.invalidateQueries({ queryKey: soundsKeys.mine() });
			if (sound.status === "approved") {
				toast.add({
					title: `Seu som "${sound.name}" foi aprovado`,
					description: "Já está na grade de todo mundo.",
					data: { tone: "success" },
				});
			} else if (sound.status === "rejected") {
				toast.add({
					title: `Seu som "${sound.name}" foi recusado`,
					description: sound.reason ?? "Veja em Configurações › Servidor › Sons.",
					data: { tone: "warning" },
				});
			}
			break;
		}
		case "voice.sound_played":
			emitSoundPlayed({
				soundId: event.sound_id,
				fileId: event.file_id,
				userId: event.user_id,
				channelId: event.channel_id,
			});
			break;
		case "ready":
			if (info.resumed) {
				void queryClient.invalidateQueries({ queryKey: soundsKeys.all() });
			}
			break;
	}
}
