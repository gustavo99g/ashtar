/**
 * As opções do microfone de Configurações › Voz e vídeo (ADR 0029), guardadas neste computador
 * (`localStorage`, como a escolha do dispositivo). Todas valem na hora, também no meio de uma
 * chamada: o `VoiceProvider` passa a mudança para a cadeia do microfone (`chain.ts`).
 *
 * Substitui o `ashtar-noise` da v0.2.3, que só guardava a supressão de ruído: quem desligou a
 * supressão continua com ela desligada (lida uma vez, na primeira abertura da 0.6).
 */
import { create } from "zustand";
import { persist } from "zustand/middleware";
import type { InputMode } from "../model/gate";

export interface InputChoice {
	/** O RNNoise na cadeia. Desligado, a supressão do próprio navegador. */
	suppression: boolean;
	/** O volume de entrada, de 0 a 200 (%). */
	volume: number;
	/** Detecção de voz ou pressionar para falar. */
	mode: InputMode;
	/** A sensibilidade automática da detecção de voz. */
	autoSensitivity: boolean;
	/** O limiar da sensibilidade manual, em dBFS (-100 a 0). */
	thresholdDb: number;
	echoCancellation: boolean;
	autoGainControl: boolean;
	/** Avisar "Você está mutado" quando a pessoa fala com o microfone mutado. */
	warnWhenMuted: boolean;
}

export const DEFAULT_INPUT: InputChoice = {
	suppression: true,
	volume: 100,
	mode: "voice",
	autoSensitivity: true,
	thresholdDb: -50,
	echoCancellation: true,
	autoGainControl: true,
	warnWhenMuted: true,
};

export const MIN_THRESHOLD_DB = -100;
export const MAX_VOLUME = 200;

const LEGACY_NOISE_KEY = "ashtar-noise";

function clamp(value: number, min: number, max: number) {
	return Math.min(max, Math.max(min, value));
}

/** A supressão guardada pela 0.2.3 a 0.5 (`ashtar-noise`), se houver. */
function legacySuppression(): boolean | undefined {
	try {
		const raw = localStorage.getItem(LEGACY_NOISE_KEY);
		if (!raw) return undefined;
		const saved = JSON.parse(raw) as { state?: { suppression?: unknown } };
		const value = saved.state?.suppression;
		return typeof value === "boolean" ? value : undefined;
	} catch {
		return undefined;
	}
}

/** Lê o que está no disco; um valor estranho volta para o padrão. */
export function readInput(saved: unknown): InputChoice {
	const value = (saved ?? {}) as Partial<Record<keyof InputChoice, unknown>>;
	const bool = (key: keyof InputChoice, fallback: boolean) =>
		typeof value[key] === "boolean" ? (value[key] as boolean) : fallback;
	const num = (key: keyof InputChoice, fallback: number, min: number, max: number) =>
		typeof value[key] === "number" && Number.isFinite(value[key])
			? clamp(value[key] as number, min, max)
			: fallback;
	return {
		suppression: bool(
			"suppression",
			legacySuppression() ?? DEFAULT_INPUT.suppression,
		),
		volume: num("volume", DEFAULT_INPUT.volume, 0, MAX_VOLUME),
		mode: value.mode === "ptt" ? "ptt" : "voice",
		autoSensitivity: bool("autoSensitivity", DEFAULT_INPUT.autoSensitivity),
		thresholdDb: num("thresholdDb", DEFAULT_INPUT.thresholdDb, MIN_THRESHOLD_DB, 0),
		echoCancellation: bool("echoCancellation", DEFAULT_INPUT.echoCancellation),
		autoGainControl: bool("autoGainControl", DEFAULT_INPUT.autoGainControl),
		warnWhenMuted: bool("warnWhenMuted", DEFAULT_INPUT.warnWhenMuted),
	};
}

export const useInputChoice = create<InputChoice>()(
	persist((): InputChoice => readInput(undefined), {
		name: "ashtar-input",
		version: 1,
		merge: (persisted, current) => ({ ...current, ...readInput(persisted) }),
	}),
);

/** Muda uma opção do microfone; vale na hora. */
export function setInputChoice(patch: Partial<InputChoice>): void {
	useInputChoice.setState(readInput({ ...useInputChoice.getState(), ...patch }));
}

/** Liga ou desliga a supressão de ruído (o interruptor da v0.2.3). */
export function setSuppression(suppression: boolean): void {
	setInputChoice({ suppression });
}
