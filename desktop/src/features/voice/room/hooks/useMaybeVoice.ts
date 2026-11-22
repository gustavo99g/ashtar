import { useContext } from "react";
import { type VoiceContextValue, VoiceContext } from "../components/VoiceProvider";

/**
 * A voz, ou `null` fora do `VoiceProvider`. Para quem só quer saber em que conexão a pessoa está
 * (a sala ou uma ligação) e funciona também sem ela, como os botões de ligar da conversa.
 */
export function useMaybeVoice(): VoiceContextValue | null {
	return useContext(VoiceContext);
}
