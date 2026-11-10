/**
 * O volume de uma trilha de áudio que chega, de 0 a 200 (%). Serve à voz de cada pessoa
 * (`userVolumeStore`) e ao som da transmissão (`shareVolumeStore`).
 *
 * Até 100%, o volume é o do elemento de áudio. Acima disso o elemento não sobe, e o som passa por
 * um `AudioContext` com ganho (o mesmo caminho que o LiveKit usa com o `webAudioMix`): o elemento
 * fica mudo e o som sai pelo contexto, na saída escolhida em Configurações. Voltando a 100% ou
 * menos, o som volta para o elemento.
 *
 * O contexto é um só para todas as trilhas reforçadas. O ganho é de cada trilha: o LiveKit cria
 * um nó de ganho por trilha dentro do contexto que recebe.
 */
import type { RemoteAudioTrack, Room } from "livekit-client";

/** As trilhas que estão saindo pelo contexto com ganho. */
const boosted = new WeakSet<RemoteAudioTrack>();
let boostContext: AudioContext | null = null;

/** Põe a trilha no volume `heard` (0 a 200), ligando ou desligando o reforço conforme o caso. */
export function applyTrackVolume(
	track: RemoteAudioTrack,
	heard: number,
	room: Room | null,
): void {
	setBoost(track, heard > 100, room);
	track.setVolume(heard / 100);
}

/** Liga ou desliga o caminho com ganho (acima de 100%) de uma trilha. */
function setBoost(track: RemoteAudioTrack, on: boolean, room: Room | null) {
	if (on === boosted.has(track)) return;
	if (on) {
		boostContext ??= new AudioContext();
		void followOutput(room);
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

/**
 * O contexto toca na mesma saída que a sala (a escolhida em Configurações). Chamado ao ligar o
 * reforço e quando a saída da sala muda: sem isso, quem está acima de 100% continuaria saindo
 * pelo aparelho antigo.
 */
export async function followOutput(room: Room | null): Promise<void> {
	if (!boostContext) return;
	const device = room?.getActiveDevice("audiooutput");
	const sink = boostContext as AudioContext & {
		setSinkId?: (id: string) => Promise<void>;
	};
	if (!sink.setSinkId) return;
	try {
		await sink.setSinkId(!device || device === "default" ? "" : device);
	} catch {
		// Uma saída que sumiu: fica a padrão do Windows.
	}
}
