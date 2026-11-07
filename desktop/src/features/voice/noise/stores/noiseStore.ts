/**
 * A opção "Supressão de ruído" de Configurações › Voz e vídeo, guardada neste computador
 * (`localStorage`, como a escolha do microfone). Ligada por padrão, como no quadro.
 */
import { create } from "zustand";
import { persist } from "zustand/middleware";

interface NoiseChoice {
	/** Ligada: o microfone passa pelo RNNoise. Desligada: a supressão do próprio navegador. */
	suppression: boolean;
}

export const useNoiseChoice = create<NoiseChoice>()(
	persist((): NoiseChoice => ({ suppression: true }), {
		name: "ashtar-noise",
		version: 1,
		// Um valor estranho no disco volta para o padrão (ligada).
		merge: (persisted, current) => {
			const saved = (persisted as Partial<NoiseChoice> | undefined)
				?.suppression;
			return {
				...current,
				suppression: typeof saved === "boolean" ? saved : true,
			};
		},
	}),
);

/** Liga ou desliga a supressão; vale na hora, também no meio de uma chamada. */
export function setSuppression(suppression: boolean): void {
	useNoiseChoice.setState({ suppression });
}
