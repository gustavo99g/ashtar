import { useContext } from "react";
import { VoiceContext } from "../components/VoiceProvider";

/**
 * O id da sala de voz em que a pessoa está, ou `null` fora de sala. Ao contrário do `useVoice`,
 * não exige o `VoiceProvider`: serve a telas que só querem saber "estou na mesma sala que
 * fulano?", como a lista de membros.
 */
export function useVoiceChannelId(): string | null {
	return useContext(VoiceContext)?.voiceChannelId ?? null;
}
