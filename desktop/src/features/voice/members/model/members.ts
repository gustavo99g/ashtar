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
	/** Fora da chamada: está com a câmera ligada (dentro, o bloco mostra a própria câmera). */
	camera?: boolean;
	/** Só dentro da chamada, e só quando está ruim: a qualidade que o LiveKit dá (decisão 15). */
	connection?: ConnectionTrouble;
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
		camera: participant.camera,
	};
}

/** "1 pessoa na Sala agora", "4 pessoas na Sala agora". */
export function peopleNowLabel(count: number, channelName: string): string {
	return `${count} ${count === 1 ? "pessoa" : "pessoas"} na ${channelName} agora`;
}
