/** O que a tela do servidor passa para a sala ao navegar (`navigate(paths.voiceRoom, { state })`). */
export interface VoiceRoomState {
	/** A identidade de quem está transmitindo: a sala já abre no Foco, assistindo essa pessoa. */
	watch?: string;
}

/** Lê o `location.state` da sala, que pode vir vazio ou de outro lugar. */
export function readVoiceRoomState(state: unknown): VoiceRoomState {
	if (typeof state === "object" && state !== null && "watch" in state) {
		const { watch } = state;
		if (typeof watch === "string") return { watch };
	}
	return {};
}
