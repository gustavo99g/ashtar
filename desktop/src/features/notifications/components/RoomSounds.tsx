/*
 * Quando cada som da sala toca (v0.5, ADR 0027). Só na sala de voz do grupo, não na ligação:
 *
 * - entrar numa sala (ou trocar para outra) toca o de entrar uma vez, sem um som por quem já estava;
 *   sair da voz toca o de sair. Trocar não toca a saída de ninguém da sala velha;
 * - alguém entrando ou saindo da sua sala, pelos eventos da conexão. A conexão `:screen` de uma
 *   transmissão (ADR 0017) é o começar e o parar de transmitir, menos a sua;
 * - mutar, desmutar, ficar surdo e voltar. Ficar surdo também muta: toca só o do surdo. Fora da voz
 *   também toca (o botão e o atalho valem lá, v0.6); numa ligação, não.
 */
import { RoomEvent, type RemoteParticipant } from "livekit-client";
import { useEffect, useRef } from "react";
import { useMaybeVoice } from "@/features/voice";
import { playRoomSound } from "../model/roomSounds";

const SCREEN_SUFFIX = ":screen";

export function RoomSounds() {
	const voice = useMaybeVoice();
	const inRoom = voice?.voiceKind === "room";
	const channelId = inRoom ? voice.voiceChannelId : null;
	const state = voice?.connectionState;
	const room = inRoom ? voice.room : null;
	const isMuted = voice?.isMuted ?? false;
	const isDeafened = voice?.isDeafened ?? false;
	const outOfVoice = (voice?.voiceChannelId ?? null) === null;

	// Entrar, trocar e sair.
	const joined = useRef<string | null>(null);
	useEffect(() => {
		if (channelId === null) {
			if (joined.current !== null) playRoomSound("leave");
			joined.current = null;
			return;
		}
		if (state === "connected" && joined.current !== channelId) {
			joined.current = channelId;
			playRoomSound("join");
		}
	}, [channelId, state]);

	// Quem entra e sai da sala, e as transmissões.
	useEffect(() => {
		if (!room) return;
		const mine = room.localParticipant.identity + SCREEN_SUFFIX;
		const changed = (participant: RemoteParticipant, came: boolean) => {
			const identity = participant.identity;
			if (identity.endsWith(SCREEN_SUFFIX)) {
				if (identity !== mine) playRoomSound(came ? "shareStart" : "shareStop");
			} else {
				playRoomSound(came ? "join" : "leave");
			}
		};
		const onConnected = (p: RemoteParticipant) => changed(p, true);
		const onDisconnected = (p: RemoteParticipant) => changed(p, false);
		room.on(RoomEvent.ParticipantConnected, onConnected);
		room.on(RoomEvent.ParticipantDisconnected, onDisconnected);
		return () => {
			room.off(RoomEvent.ParticipantConnected, onConnected);
			room.off(RoomEvent.ParticipantDisconnected, onDisconnected);
		};
	}, [room]);

	// O próprio microfone e o próprio áudio: fora da voz, ou com a sala conectada.
	const before = useRef({ isMuted, isDeafened });
	useEffect(() => {
		const was = before.current;
		before.current = { isMuted, isDeafened };
		const inConnectedRoom = channelId !== null && state === "connected";
		if (!outOfVoice && !inConnectedRoom) return;
		if (was.isDeafened !== isDeafened) {
			playRoomSound(isDeafened ? "deafen" : "undeafen");
		} else if (was.isMuted !== isMuted) {
			playRoomSound(isMuted ? "mute" : "unmute");
		}
	}, [isMuted, isDeafened, channelId, state, outOfVoice]);

	return null;
}
