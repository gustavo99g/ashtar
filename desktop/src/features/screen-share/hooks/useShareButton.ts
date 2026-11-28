import { type ParticipantPerson, participantPerson } from "@/features/identity";
import type { ScreenShareController } from "../model/controller";
import { sharerLabel } from "../model/shareInfo";
import { openSourcePicker } from "../stores/pickerStore";
import { useScreenShareState } from "./useScreenShareState";
import type { ScreenShare } from "./useScreenShares";

/**
 * Quem transmite `share`: o nome e o nick vêm da `:screen` (a API repete os do dono), o id é o dono.
 * A tela de um aparelho leva o nome dele junto ("Kid · Odin 3", ADR 0038).
 */
export function sharePerson(share: ScreenShare): ParticipantPerson {
	const person = participantPerson(share.track.participant);
	return {
		...person,
		id: share.ownerId,
		name: sharerLabel(person.name, share.source),
	};
}

/**
 * O comportamento do botão Tela, para a barra da sala e o painel "Voz conectada" desenharem cada
 * um o seu. Transmitindo, quem usa abre os ajustes rápidos (`ShareQuickSettings`) e o clique não
 * faz mais nada; senão, abre o seletor. Outras pessoas transmitindo não travam o botão (ADR 0024):
 * quem decide o limite da sala é a API, no token da transmissão.
 */
export function useShareButton(controller: ScreenShareController) {
	const state = useScreenShareState(controller);

	const active = state.status === "active";
	const paused = state.status === "active" && state.paused;
	const starting = state.status === "starting";

	return {
		active,
		paused,
		starting,
		onClick: () => {
			if (!active) openSourcePicker();
		},
	};
}
