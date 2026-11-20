import { useIdleReporter } from "../hooks/useIdleReporter";

/** Montado uma vez no `App`, dentro do `VoiceProvider`: o Ausente automático (ADR 0027). */
export function IdleReporter() {
	useIdleReporter();
	return null;
}
