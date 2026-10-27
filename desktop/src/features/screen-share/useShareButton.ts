import type { Participant } from "livekit-client";
import type { ScreenShareController } from "./controller";
import { openSourcePicker } from "./pickerStore";
import { useScreenShareState } from "./useScreenShareState";
import { useScreenShares } from "./useScreenShares";

/**
 * O comportamento do botão Tela, para a barra da sala e o painel "Voz conectada" desenharem cada
 * um o seu. Transmitindo, para; com outra pessoa transmitindo (`busyWith`), quem usa explica e
 * oferece Assistir; senão, abre o seletor. A trava olha as publicações de tela da sala, não só as
 * trilhas assinadas. Usa hooks do LiveKit: só com a sala conectada.
 */
export function useShareButton(controller: ScreenShareController) {
	const state = useScreenShareState(controller);
	const { winner } = useScreenShares();

	const active = state.status === "active";
	const starting = state.status === "starting";
	const busyWith: Participant | null =
		!active && winner && !winner.participant.isLocal
			? winner.participant
			: null;

	return {
		active,
		starting,
		busyWith,
		onClick: () => {
			if (active) {
				void controller.stop();
				return;
			}
			if (!busyWith) openSourcePicker();
		},
	};
}
