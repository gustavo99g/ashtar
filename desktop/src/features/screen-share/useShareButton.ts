import { useTracks } from "@livekit/components-react";
import { Track } from "livekit-client";
import type { ScreenShareController } from "./controller";
import { openSourcePicker } from "./pickerStore";
import { useScreenShareState } from "./useScreenShareState";

/**
 * O comportamento do botão Tela, para a barra da sala e o painel "Voz conectada" desenharem cada
 * um o seu: transmitindo, para; senão, abre o seletor. Usa hooks do LiveKit: só com a sala
 * conectada.
 */
export function useShareButton(controller: ScreenShareController) {
	const state = useScreenShareState(controller);
	// Todas as publicações de tela, assinadas ou não: a sala só assina a tela de quem está no palco
	// do Foco (`voice/subscriptions.ts`), e a trava vale para qualquer transmissão da sala.
	const someoneElseSharing = useTracks([Track.Source.ScreenShare], {
		onlySubscribed: false,
	}).some(
		(trackRef) => !trackRef.participant.isLocal,
	);

	const active = state.status === "active";
	const starting = state.status === "starting";

	return {
		active,
		disabled: starting || (!active && someoneElseSharing),
		onClick: () => {
			if (active) {
				void controller.stop();
				return;
			}
			openSourcePicker();
		},
	};
}
