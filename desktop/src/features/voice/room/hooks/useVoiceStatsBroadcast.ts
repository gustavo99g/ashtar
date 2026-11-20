import { type Room, Track } from "livekit-client";
import { useEffect } from "react";
import { pingFromStats } from "../../dock/model/ping";
import { VOICE_STATE_TOPIC } from "../model/voiceState";
import {
	encodeVoiceStats,
	lossFromStats,
	VOICE_STATS_EVERY_MS,
	type VoiceStats,
} from "../model/voiceStats";
import { setVoiceStats } from "../stores/voiceStatsStore";

/**
 * Mede o ping e a perda da própria conexão a cada 5 segundos, guarda para o próprio cartão e manda
 * para a sala (decisão 15). Pelo microfone; sem ele (mutado desde a entrada), pelo áudio de alguém.
 * Sem trilha nenhuma, não há o que medir.
 */
export function useVoiceStatsBroadcast(room: Room | null) {
	useEffect(() => {
		if (!room) return;
		let cancelled = false;

		async function measure(current: Room) {
			const stats = await measureStats(current);
			if (cancelled || !stats) return;
			setVoiceStats(current.localParticipant.identity, stats);
			await current.localParticipant
				.publishData(encodeVoiceStats(stats), {
					reliable: false,
					topic: VOICE_STATE_TOPIC,
				})
				.catch((error: unknown) =>
					console.warn("Erro ao mandar os números da conexão:", error),
				);
		}

		void measure(room);
		const timer = setInterval(() => void measure(room), VOICE_STATS_EVERY_MS);
		return () => {
			cancelled = true;
			clearInterval(timer);
		};
	}, [room]);
}

async function measureStats(room: Room): Promise<VoiceStats | null> {
	const track =
		room.localParticipant.getTrackPublication(Track.Source.Microphone)?.track ??
		[...room.remoteParticipants.values()]
			.flatMap((participant) => [...participant.audioTrackPublications.values()])
			.find((publication) => publication.track)?.track;
	const report = await track?.getRTCStatsReport().catch(() => undefined);
	if (!report) return null;
	return { ping: pingFromStats(report), loss: lossFromStats(report) };
}
