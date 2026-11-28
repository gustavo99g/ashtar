import { useParticipants } from "@livekit/components-react";
import { ConnectionQuality, type Participant } from "livekit-client";
import { participantPerson } from "@/features/identity";
import {
	isDeviceShareKey,
	isScreenIdentity,
	shareKey,
	shareOwner,
	shareSource,
} from "@/features/screen-share";
import { useVoice } from "../../room/hooks/useVoice";
import { useModeration } from "../../room/stores/moderationStore";
import {
	type ChannelMember,
	type ConnectionTrouble,
	deviceMember,
} from "../model/members";

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
	// O que a moderação impôs aos outros vem da lista da API (o `voice.participants`); o próprio, do
	// estado que o `VoiceProvider` cumpre.
	const own = useModeration();
	// A tela do computador de alguém é a `:screen` dele (ADR 0017): não é um membro, só marca o
	// dono. A de um aparelho também não marca: ela vira uma entrada à parte (`useLiveDevices`).
	const screens = new Set(
		participants
			.filter(
				(p) =>
					isScreenIdentity(p.identity) &&
					!isDeviceShareKey(shareKey(p.identity)) &&
					p.isScreenShareEnabled,
			)
			.map((p) => shareOwner(p.identity)),
	);

	return participants
		.filter((participant) => !isScreenIdentity(participant.identity))
		.map((participant) => ({
			...participantPerson(participant),
			participant,
			isLocal: participant.isLocal,
			sharing:
				participant.isScreenShareEnabled || screens.has(participant.identity),
			speaking: participant.isSpeaking,
			micOff: !participant.isMicrophoneEnabled,
			camera: participant.isCameraEnabled,
			deafened: participant.isLocal
				? isDeafened
				: deafenedIds.has(participant.identity),
			serverMuted: participant.isLocal
				? own.serverMuted
				: own.others[participant.identity]?.muted === true,
			serverDeafened: participant.isLocal
				? own.serverDeafened
				: own.others[participant.identity]?.deafened === true,
			soundsBlocked: own.others[participant.identity]?.sounds === true,
			connection: trouble(participant.connectionQuality),
		}));
}

/**
 * Os aparelhos que estão transmitindo na sala (ADR 0038), cada um como uma entrada à parte na
 * lista, com o nome dele ("Odin 3"). Sem o dono na sala, o aparelho fica de fora, como na API.
 */
export function useLiveDevices(): ChannelMember[] {
	const participants = useParticipants();
	return participants.flatMap((participant) => {
		const key = shareKey(participant.identity);
		if (
			!isScreenIdentity(participant.identity) ||
			!isDeviceShareKey(key) ||
			!participant.isScreenShareEnabled
		) {
			return [];
		}
		const owner = participants.find(
			(p) => p.identity === shareOwner(participant.identity),
		);
		if (!owner) return [];
		return [
			deviceMember(
				key,
				shareSource(participant.metadata) ?? "Aparelho",
				{ id: owner.identity, name: participantPerson(owner).name },
			),
		];
	});
}

/** Só a qualidade ruim vira marca; a boa não mostra nada. */
export function trouble(
	quality: ConnectionQuality,
): ConnectionTrouble | undefined {
	if (quality === ConnectionQuality.Poor) return "unstable";
	if (quality === ConnectionQuality.Lost) return "bad";
	return undefined;
}
