import { useVoice } from "@/features/voice";

/**
 * Se a pessoa está numa chamada (ou entrando nela). Aí o Reiniciar pede confirmação, porque
 * instalar fecha o app e derruba a chamada, e o aviso sobe para não cobrir a barra da sala.
 */
export function useInCall() {
	const { connectionState } = useVoice();
	return connectionState !== "disconnected" && connectionState !== "error";
}
