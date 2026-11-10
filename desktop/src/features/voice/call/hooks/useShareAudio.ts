import type { TrackReference } from "@livekit/components-react";
import { RemoteAudioTrack, type Room, Track, TrackEvent } from "livekit-client";
import { useEffect } from "react";
import { useVoice } from "../../room/hooks/useVoice";
import { audibleVolume, useShareVolume } from "../stores/shareVolumeStore";

/**
 * O áudio da transmissão `share`, se ela tiver, já no volume gravado (`shareVolumeStore.ts`).
 * O palco do Foco e a miniatura usam o mesmo: o volume escolhido num vale no outro.
 *
 * Até 100%, o volume é o do elemento de áudio. Acima disso o elemento não sobe, e o som passa por
 * um `AudioContext` com ganho (o mesmo caminho que o LiveKit usa com o `webAudioMix`): o elemento
 * fica mudo e o som sai pelo contexto, na saída escolhida em Configurações. Voltando a 100% ou
 * menos, o som volta para o elemento.
 */
export function useShareAudio(share: TrackReference): {
	remoteAudio: RemoteAudioTrack | undefined;
	heard: number;
} {
	const { room } = useVoice();
	const heard = useShareVolume(audibleVolume);
	const audioTrack = share.participant.getTrackPublication(
		Track.Source.ScreenShareAudio,
	)?.track;
	const remoteAudio =
		audioTrack instanceof RemoteAudioTrack ? audioTrack : undefined;

	useEffect(() => {
		if (!remoteAudio) return;
		const apply = () => {
			setBoost(remoteAudio, heard > 100, room);
			remoteAudio.setVolume(heard / 100);
		};
		apply();
		// O `RoomAudio` pode ligar o elemento de áudio depois deste efeito, e o LiveKit não
		// reaplica um volume zero ao ligar: aplica de novo nessa hora.
		remoteAudio.on(TrackEvent.ElementAttached, apply);
		return () => {
			remoteAudio.off(TrackEvent.ElementAttached, apply);
		};
	}, [remoteAudio, heard, room]);

	return { remoteAudio, heard };
}

/** As trilhas que estão saindo pelo contexto com ganho. */
const boosted = new WeakSet<RemoteAudioTrack>();
let boostContext: AudioContext | null = null;

/** Liga ou desliga o caminho com ganho (acima de 100%) de uma trilha. */
function setBoost(track: RemoteAudioTrack, on: boolean, room: Room | null) {
	if (on === boosted.has(track)) return;
	if (on) {
		boostContext ??= new AudioContext();
		void followOutput(boostContext, room);
		track.setAudioContext(boostContext);
		// O LiveKit só cala o elemento ao ligar um elemento novo; este já estava ligado.
		for (const element of track.attachedElements) element.muted = true;
		boosted.add(track);
	} else {
		track.setAudioContext(undefined);
		for (const element of track.attachedElements) element.muted = false;
		boosted.delete(track);
	}
}

/** O contexto toca na mesma saída que a sala (a escolhida em Configurações). */
async function followOutput(context: AudioContext, room: Room | null) {
	const device = room?.getActiveDevice("audiooutput");
	const sink = context as AudioContext & {
		setSinkId?: (id: string) => Promise<void>;
	};
	if (!sink.setSinkId) return;
	try {
		await sink.setSinkId(!device || device === "default" ? "" : device);
	} catch {
		// Uma saída que sumiu: fica a padrão do Windows.
	}
}
