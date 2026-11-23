/*
 * Quando cada som da sala toca (v0.5, ADR 0027). Só na sala de voz do grupo, não na ligação:
 *
 * - entrar numa sala toca o de entrar uma vez, sem um som por quem já estava; sair da voz toca o de
 *   sair; trocar de sala toca os dois, o de sair no clique e o de entrar quando a nova conecta. Não
 *   toca a saída de ninguém da sala velha;
 * - alguém entrando ou saindo da sua sala, pelos eventos da conexão. A conexão `:screen` de uma
 *   transmissão (ADR 0017) é o começar e o parar de transmitir, menos a sua;
 * - com o áudio desligado (surdo), nada dos outros toca: só os sons dos próprios botões e o de
 *   entrar e sair da sala, como no Discord;
 * - mutar, desmutar, ficar surdo e voltar. Ficar surdo também muta: toca só o do surdo. Fora da voz
 *   também toca (o botão e o atalho valem lá, v0.6); numa ligação, não;
 * - a própria transmissão começando e parando, e a própria câmera ligando e desligando (v0.8), na
 *   sala e na ligação. Sair da voz com elas ligadas toca só o de sair;
 * - uma transmissão que acaba e volta em [`SHARE_RETURN_MS`] (a do jogo, que recomeça no cliente
 *   quando a partida fecha) não toca nada. Por isso o parar dos outros chega com esse atraso; o
 *   próprio parar à mão toca na hora.
 */
import { RoomEvent, type RemoteParticipant } from "livekit-client";
import { useEffect, useRef } from "react";
import { useScreenShareState } from "@/features/screen-share";
import { useCameraState, useMaybeVoice } from "@/features/voice";
import { playRoomSound } from "../model/roomSounds";

const SCREEN_SUFFIX = ":screen";

/**
 * Quanto o som de parar de transmitir espera para ver se a transmissão volta (v0.8): a partida do
 * jogo fechou e a transmissão recomeçou no cliente. Voltou nesse tempo: nenhum dos dois toca.
 */
export const SHARE_RETURN_MS = 6_000;

export function RoomSounds() {
	const voice = useMaybeVoice();
	const inRoom = voice?.voiceKind === "room";
	const channelId = inRoom ? voice.voiceChannelId : null;
	const state = voice?.connectionState;
	const room = inRoom ? voice.room : null;
	const isMuted = voice?.isMuted ?? false;
	const isDeafened = voice?.isDeafened ?? false;
	const outOfVoice = (voice?.voiceChannelId ?? null) === null;
	const deafened = useRef(isDeafened);
	deafened.current = isDeafened;

	// Entrar, trocar e sair. Trocar toca o de sair na hora do clique e o de entrar quando a sala
	// nova fica pronta (`room`, que só chega depois de o microfone abrir). Os próprios não têm o
	// intervalo: trocar rápido de sala toca cada um.
	const joined = useRef<string | null>(null);
	const ready = state === "connected" && room !== null;
	useEffect(() => {
		if (joined.current !== null && joined.current !== channelId) {
			playRoomSound("leave", { gap: false });
			joined.current = null;
		}
		if (channelId !== null && ready && joined.current === null) {
			joined.current = channelId;
			playRoomSound("join", { gap: false });
		}
	}, [channelId, ready]);

	// Quem entra e sai da sala, e as transmissões.
	useEffect(() => {
		if (!room) return;
		const mine = room.localParticipant.identity + SCREEN_SUFFIX;
		// As transmissões que acabaram há pouco, esperando para ver se voltam.
		const stopping = new Map<string, ReturnType<typeof setTimeout>>();
		const changed = (participant: RemoteParticipant, came: boolean) => {
			const identity = participant.identity;
			if (identity.endsWith(SCREEN_SUFFIX)) {
				if (identity === mine) return;
				const pending = stopping.get(identity);
				if (came) {
					if (pending !== undefined) {
						clearTimeout(pending);
						stopping.delete(identity);
						return;
					}
					if (!deafened.current) playRoomSound("shareStart");
					return;
				}
				clearTimeout(pending);
				stopping.set(
					identity,
					setTimeout(() => {
						stopping.delete(identity);
						if (!deafened.current) playRoomSound("shareStop");
					}, SHARE_RETURN_MS),
				);
			} else if (!deafened.current) {
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
			for (const timer of stopping.values()) clearTimeout(timer);
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
			playRoomSound(isDeafened ? "deafen" : "undeafen", { gap: false });
		} else if (was.isMuted !== isMuted) {
			playRoomSound(isMuted ? "mute" : "unmute", { gap: false });
		}
	}, [isMuted, isDeafened, channelId, state, outOfVoice]);

	// A própria transmissão e a própria câmera, com a voz ainda de pé.
	const connected = (voice?.voiceChannelId ?? null) !== null;
	const stillConnected = useRef(connected);
	stillConnected.current = connected;
	const shareState = useScreenShareState(voice?.screenShare ?? null);
	const sharing = shareState.status === "active";
	const sourceClosed =
		shareState.status === "idle" && shareState.ended === "sourceClosed";
	const wasSharing = useRef(sharing);
	// A janela fechou sozinha: o parar espera para ver se a transmissão volta.
	const ownStopping = useRef<ReturnType<typeof setTimeout> | null>(null);
	useEffect(() => {
		if (wasSharing.current === sharing) return;
		wasSharing.current = sharing;
		if (sharing && ownStopping.current !== null) {
			clearTimeout(ownStopping.current);
			ownStopping.current = null;
			return;
		}
		if (!stillConnected.current) return;
		if (!sharing && sourceClosed) {
			ownStopping.current = setTimeout(() => {
				ownStopping.current = null;
				if (stillConnected.current) {
					playRoomSound("shareStop", { gap: false });
				}
			}, SHARE_RETURN_MS);
			return;
		}
		playRoomSound(sharing ? "shareStart" : "shareStop", { gap: false });
	}, [sharing, sourceClosed]);
	useEffect(
		() => () => {
			if (ownStopping.current !== null) clearTimeout(ownStopping.current);
		},
		[],
	);
	const cameraOn = useCameraState((camera) => camera.on);
	const wasCameraOn = useRef(cameraOn);
	useEffect(() => {
		if (wasCameraOn.current === cameraOn) return;
		wasCameraOn.current = cameraOn;
		if (stillConnected.current) {
			playRoomSound(cameraOn ? "cameraOn" : "cameraOff", { gap: false });
		}
	}, [cameraOn]);

	return null;
}
