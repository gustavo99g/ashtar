import { useContext } from "react";
import { VoiceContext } from "./VoiceProvider";

export function useVoice() {
	const context = useContext(VoiceContext);
	if (!context) {
		throw new Error("useVoice deve ser usado dentro de VoiceProvider.");
	}
	return context;
}
