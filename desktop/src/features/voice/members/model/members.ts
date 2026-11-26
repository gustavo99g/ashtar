/*
 * Quem está na sala, do jeito que a coluna do servidor e as telas mostram. Vem da API (fora da
 * chamada) ou do LiveKit (dentro dela), e as duas fontes viram a mesma forma.
 */
import type { ParticipantView } from "@/lib/api";

export interface ChannelMember {
	/** O id do usuário na API (a identidade no LiveKit). */
	id: string;
	nick: string;
	/** O nome visível, ou o nick quando não há um. */
	name: string;
	/** Está transmitindo a tela (o selo TRANSMITINDO). */
	sharing: boolean;
	/** Só dentro da chamada: falando agora. */
	speaking?: boolean;
	/** Sem microfone (mutado ou sem trilha). Fora da chamada, pelo que o app da pessoa contou. */
	micOff?: boolean;
	/** Desligou o áudio (deafen). */
	deafened?: boolean;
	/** Silenciada pela moderação (ADR 0034): o microfone vermelho com o escudo. */
	serverMuted?: boolean;
	/** Com o áudio desligado pela moderação. */
	serverDeafened?: boolean;
	/** Com os sons do soundboard bloqueados pela moderação (v0.9). */
	soundsBlocked?: boolean;
	/** Fora da chamada: está com a câmera ligada (dentro, o bloco mostra a própria câmera). */
	camera?: boolean;
	/** O que está transmitindo, pelo que o app da pessoa contou à API (o cartão de Assistir). */
	share?: ShareSummary;
	/** Só dentro da chamada, e só quando está ruim: a qualidade que o LiveKit dá (decisão 15). */
	connection?: ConnectionTrouble;
}

export interface ShareSummary {
	/** A tela ou o título da janela. */
	title: string;
	window: boolean;
	/** A chave do preset (`1080p60`...). */
	quality: string;
	/** `Date.now()` de quando começou. */
	startedAt: number;
	viewers: number;
}

/** `unstable`: a qualidade `poor` do LiveKit (laranja); `bad`: `lost` (vermelho). */
export type ConnectionTrouble = "unstable" | "bad";

/** Um participante da lista da API (`GET /api/voice/participants`). */
export function memberFromApi(participant: ParticipantView): ChannelMember {
	return {
		id: participant.user_id,
		nick: participant.nick,
		name: participant.display_name?.trim() || participant.nick,
		sharing: participant.screen_sharing,
		micOff: participant.mic_off,
		deafened: participant.deafened,
		serverMuted: participant.server_muted,
		serverDeafened: participant.server_deafened,
		soundsBlocked: participant.sounds_blocked,
		camera: participant.camera,
		share: participant.share
			? {
					title: participant.share.title,
					window: participant.share.window,
					quality: participant.share.quality,
					startedAt: participant.share.started_at,
					viewers: participant.share.viewers,
				}
			: undefined,
	};
}

/**
 * A ordem da lista da sala: quem transmite vem primeiro, do que começou por último para o mais
 * antigo; o resto fica na ordem de sempre. Quem acabou de começar e ainda não tem o horário na API
 * conta como o mais novo.
 */
export function sharingFirst<T extends ChannelMember>(members: T[]): T[] {
	const started = (member: T) => member.share?.startedAt ?? Number.POSITIVE_INFINITY;
	return [...members].sort((a, b) => {
		if (a.sharing !== b.sharing) return a.sharing ? -1 : 1;
		if (!a.sharing) return 0;
		const diff = started(b) - started(a);
		return Number.isNaN(diff) ? 0 : diff;
	});
}

/** "1 pessoa na Sala agora", "4 pessoas na Sala agora". */
export function peopleNowLabel(count: number, channelName: string): string {
	return `${count} ${count === 1 ? "pessoa" : "pessoas"} na ${channelName} agora`;
}
