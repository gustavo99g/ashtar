import { type ParticipantPerson, participantPerson } from "@/features/identity";
import type { ScreenShareController } from "../model/controller";
import { openSourcePicker } from "../stores/pickerStore";
import { useScreenShareState } from "./useScreenShareState";
import { type ScreenShare, useScreenShares } from "./useScreenShares";

/** Quem transmite `share`: o nome e o nick vêm da `:screen` (a API repete os do dono), o id é o dono. */
export function sharePerson(share: ScreenShare): ParticipantPerson {
	return { ...participantPerson(share.track.participant), id: share.ownerId };
}

/**
 * O comportamento do botão Tela, para a barra da sala e o painel "Voz conectada" desenharem cada
 * um o seu. Transmitindo, quem usa abre os ajustes rápidos (`ShareQuickSettings`) e o clique não
 * faz mais nada; com outra pessoa transmitindo (`busyWith`), quem usa explica e oferece Assistir;
 * senão, abre o seletor. A trava olha as publicações de tela da sala, não só as
 * trilhas assinadas. Usa hooks do LiveKit: só com a sala conectada.
 */
export function useShareButton(controller: ScreenShareController) {
	const state = useScreenShareState(controller);
	const { winner } = useScreenShares();

	const active = state.status === "active";
	const paused = state.status === "active" && state.paused;
	const starting = state.status === "starting";
	const busyWith: ParticipantPerson | null =
		!active && winner && !winner.isOwn ? sharePerson(winner) : null;

	return {
		active,
		paused,
		starting,
		busyWith,
		onClick: () => {
			if (!active && !busyWith) openSourcePicker();
		},
	};
}
