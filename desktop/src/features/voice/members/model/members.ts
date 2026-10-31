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
	/** Só dentro da chamada: sem microfone (mutado ou sem trilha). */
	micOff?: boolean;
	/** Só dentro da chamada: desligou o áudio (deafen). */
	deafened?: boolean;
}

/** Um participante da lista da API (`GET /api/voice/participants`). */
export function memberFromApi(participant: ParticipantView): ChannelMember {
	return {
		id: participant.user_id,
		nick: participant.nick,
		name: participant.display_name?.trim() || participant.nick,
		sharing: participant.screen_sharing,
	};
}

/** "1 pessoa na Sala agora", "4 pessoas na Sala agora". */
export function peopleNowLabel(count: number, channelName: string): string {
	return `${count} ${count === 1 ? "pessoa" : "pessoas"} na ${channelName} agora`;
}
