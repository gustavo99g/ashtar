/**
 * O que a moderação impôs a esta pessoa na voz (ADR 0034): silenciada e com o áudio desligado. Vem
 * do token de voz, a cada entrada, e do `voice.moderated`, no meio da chamada. Quem cumpre é o
 * `VoiceProvider`: muta, trava o botão, o atalho e o Pressionar para falar, e solta quando liberam.
 *
 * Desligar a câmera e encerrar a transmissão são de uma vez só: ficam em `notice` até o
 * `VoiceProvider` cumprir e mostrar o aviso.
 */
import { create } from "zustand";

export interface ModerationNotice {
	action: "camera_off" | "stop_share";
	byName: string;
}

interface ModerationState {
	serverMuted: boolean;
	serverDeafened: boolean;
	notice: ModerationNotice | null;
	/**
	 * Os outros que a moderação travou, pela última lista de cada sala (`voice.participants`):
	 * dentro da chamada, a lista vem do LiveKit, que não sabe disso.
	 */
	others: Record<string, { muted: boolean; deafened: boolean }>;
}

export const useModeration = create<ModerationState>()(() => ({
	serverMuted: false,
	serverDeafened: false,
	notice: null,
	others: {},
}));

/** Guarda o que a moderação impôs a quem está numa lista de sala. */
export function rememberModerated(
	people: { user_id: string; server_muted: boolean; server_deafened: boolean }[],
): void {
	useModeration.setState((state) => {
		const others = { ...state.others };
		for (const person of people) {
			if (person.server_muted || person.server_deafened) {
				others[person.user_id] = {
					muted: person.server_muted,
					deafened: person.server_deafened,
				};
			} else {
				delete others[person.user_id];
			}
		}
		return { others };
	});
}

export function setImposed(serverMuted: boolean, serverDeafened: boolean): void {
	useModeration.setState({ serverMuted, serverDeafened });
}

export function setModerationNotice(notice: ModerationNotice): void {
	useModeration.setState({ notice });
}

export function clearModerationNotice(): void {
	useModeration.setState({ notice: null });
}
