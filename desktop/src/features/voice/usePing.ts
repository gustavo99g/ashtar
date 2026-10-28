import { type Room, Track } from "livekit-client";
import { useEffect, useState } from "react";
import { useAppVisible } from "@/lib/visibility";
import { pingFromStats } from "./ping";

/** De quanto em quanto tempo o painel "Voz conectada" mede o ping. */
const PING_REFRESH_MS = 5_000;

/**
 * O ping da chamada, medido no `getStats` do microfone (ou do áudio de alguém, quando o
 * microfone nunca abriu), de 5 em 5 segundos com o app à vista. `null` enquanto não há medida.
 */
export function usePing(room: Room | null): number | null {
	const visible = useAppVisible();
	const [ping, setPing] = useState<number | null>(null);

	useEffect(() => {
		if (!room || !visible) return;
		let cancelled = false;

		async function measure(current: Room) {
			const track =
				current.localParticipant.getTrackPublication(Track.Source.Microphone)
					?.track ??
				[...current.remoteParticipants.values()]
					.flatMap((participant) => [
						...participant.audioTrackPublications.values(),
					])
					.find((publication) => publication.track)?.track;
			const report = await track?.getRTCStatsReport().catch(() => undefined);
			if (!cancelled) setPing(report ? pingFromStats(report) : null);
		}

		void measure(room);
		const timer = setInterval(() => void measure(room), PING_REFRESH_MS);
		return () => {
			cancelled = true;
			clearInterval(timer);
		};
	}, [room, visible]);

	return room ? ping : null;
}
