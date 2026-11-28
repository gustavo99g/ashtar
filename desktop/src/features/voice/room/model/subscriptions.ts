/**
 * Quais trilhas da sala este app baixa. A sala entra com `autoSubscribe: false` (no
 * `VoiceProvider`), e cada publicação passa por aqui:
 *
 * - a voz de todo mundo, sempre;
 * - a tela transmitida e o áudio dela, só das transmissões desenhadas agora (`shown` do
 *   `roomView`), no palco ou na miniatura. A tela de alguém vem da `:screen` dele (ADR 0017): conta
 *   o dono. A própria `:screen` nunca é assinada: seria baixar a própria tela, e ouvir o próprio
 *   áudio;
 * - a câmera de cada um, só com os blocos da sala à vista (ADR 0025): na Grade, a camada do meio;
 *   na fileira de baixo do palco, a baixa.
 *
 * A transmissão pequena (na fileira de baixo) ou com a qualidade Leve escolhida pede a camada
 * baixa; a grande, a alta (ADR 0024). Sem camadas publicadas, o pedido não muda nada.
 *
 * Na Grade ou no canal sem a miniatura, nenhuma transmissão é baixada (nas configurações, a
 * miniatura continua desde a v0.9): a Grade
 * não mostra a imagem, e o vídeo de uma tela gastaria a internet de cada um à toa.
 */

import {
	type RemoteParticipant,
	type RemoteTrackPublication,
	type Room,
	Track,
	VideoQuality,
} from "livekit-client";
import { shareKey } from "@/features/screen-share";
import type { ShownSize } from "../../call/stores/roomViewStore";

const SCREEN_SOURCES: ReadonlySet<Track.Source> = new Set([
	Track.Source.ScreenShare,
	Track.Source.ScreenShareAudio,
]);

/** O que aparece agora: as transmissões, com o tamanho de cada uma, e os blocos com as câmeras. */
export interface SubscriptionView {
	shown: Readonly<Record<string, ShownSize>>;
	/** `false`: os blocos não estão à vista; senão, o tamanho deles (Grade ou fileira de baixo). */
	cameras: ShownSize | false;
	/** A câmera em foco, grande no palco: vem na camada alta. */
	bigCamera?: string | null;
}

/** Nada à vista: só as vozes. */
export const NOTHING_SHOWN: SubscriptionView = { shown: {}, cameras: false };

/** Se este app (de `me`) quer a trilha `source` de `identity`, com `view` na tela. */
export function wantsTrack(
	source: Track.Source,
	identity: string,
	view: SubscriptionView,
	me: string,
): boolean {
	if (source === Track.Source.Camera) return view.cameras !== false && identity !== me;
	if (!SCREEN_SOURCES.has(source)) return true;
	// A chave: a tela do computador conta o dono (a própria nunca é baixada); a de um aparelho conta
	// a identidade inteira, e a de um aparelho da própria pessoa pode ser assistida (ADR 0038).
	const key = shareKey(identity);
	return key !== me && key in view.shown;
}

/**
 * A camada pedida para o vídeo `source` de `identity`: a tela, a baixa se aparece pequena e a alta
 * se grande; a câmera, a do meio na Grade e a baixa na fileira de baixo.
 */
export function wantedQuality(
	source: Track.Source,
	identity: string,
	view: SubscriptionView,
): VideoQuality {
	if (source === Track.Source.Camera) {
		if (view.bigCamera === identity) return VideoQuality.HIGH;
		return view.cameras === "small" ? VideoQuality.LOW : VideoQuality.MEDIUM;
	}
	return view.shown[shareKey(identity)] === "small"
		? VideoQuality.LOW
		: VideoQuality.HIGH;
}

const VIDEO_SOURCES: ReadonlySet<Track.Source> = new Set([
	Track.Source.ScreenShare,
	Track.Source.Camera,
]);

/** Assina ou cancela uma publicação, só quando muda: cada troca é uma mensagem ao servidor. */
export function syncSubscription(
	publication: RemoteTrackPublication,
	participant: RemoteParticipant,
	view: SubscriptionView,
	me: string,
): void {
	const want = wantsTrack(publication.source, participant.identity, view, me);
	if (publication.isDesired !== want) publication.setSubscribed(want);
	if (want && VIDEO_SOURCES.has(publication.source)) {
		const quality = wantedQuality(
			publication.source,
			participant.identity,
			view,
		);
		if (publication.videoQuality !== quality) {
			publication.setVideoQuality(quality);
		}
	}
}

/** Passa por todas as publicações de quem está na sala. */
export function syncSubscriptions(room: Room, view: SubscriptionView): void {
	const me = room.localParticipant.identity;
	for (const participant of room.remoteParticipants.values()) {
		for (const publication of participant.trackPublications.values()) {
			syncSubscription(publication, participant, view, me);
		}
	}
}
