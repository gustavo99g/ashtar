/**
 * O volume de saída de Configurações › Voz e vídeo (ADR 0029), de 0 a 200 (%), guardado neste
 * computador. Multiplica todas as vozes e transmissões que chegam, por cima do volume que a pessoa
 * escolheu para cada uma (`useTrackVolume`).
 */
import { create } from "zustand";
import { persist } from "zustand/middleware";

export const MAX_OUTPUT_VOLUME = 200;

interface OutputVolume {
	volume: number;
}

function readVolume(value: unknown): number {
	return typeof value === "number" && Number.isFinite(value)
		? Math.min(MAX_OUTPUT_VOLUME, Math.max(0, value))
		: 100;
}

export const useOutputVolume = create<OutputVolume>()(
	persist((): OutputVolume => ({ volume: 100 }), {
		name: "ashtar-output",
		version: 1,
		merge: (persisted, current) => ({
			...current,
			volume: readVolume((persisted as Partial<OutputVolume> | undefined)?.volume),
		}),
	}),
);

export function setOutputVolume(volume: number): void {
	useOutputVolume.setState({ volume: readVolume(volume) });
}
