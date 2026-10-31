import { useParticipants } from "@livekit/components-react";
import type { Participant } from "livekit-client";
import { participantPerson } from "@/features/identity";
import type { ChannelMember } from "../model/members";
import { useVoice } from "../../room/hooks/useVoice";

export interface LiveMember extends ChannelMember {
	participant: Participant;
	isLocal: boolean;
}

/**
 * Quem está na chamada, pelo próprio LiveKit: quem fala, quem está sem microfone e quem
 * transmite. O deafen dos outros vem dos avisos por mensagem de dados (`voiceState.ts`). O
 * `useParticipants` redesenha a cada evento da sala (fala, mute, trilha nova), então os campos
 * lidos do participante aqui ficam em dia. Só dentro da sala conectada.
 */
export function useLiveMembers(): LiveMember[] {
	const participants = useParticipants();
	const { isDeafened, deafenedIds } = useVoice();

	return participants.map((participant) => ({
		...participantPerson(participant),
		participant,
		isLocal: participant.isLocal,
		sharing: participant.isScreenShareEnabled,
		speaking: participant.isSpeaking,
		micOff: !participant.isMicrophoneEnabled,
		deafened: participant.isLocal
			? isDeafened
			: deafenedIds.has(participant.identity),
	}));
}
