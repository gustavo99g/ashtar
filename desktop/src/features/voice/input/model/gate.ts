/**
 * O portão do microfone (ADR 0029): decide, bloco a bloco, se a voz passa. É a mesma lógica para a
 * detecção de voz (abre com a voz acima da sensibilidade) e para o pressionar para falar (abre com
 * o atalho apertado). Roda dentro do AudioWorklet (`worklet/gate.worklet.ts`), sem DOM, e por isso
 * fica aqui, pura, para os testes.
 *
 * - Abre depois de [`OPEN_MS`] de voz acima do limiar, e fecha [`HOLD_MS`] depois de a voz cair (ou
 *   de o atalho ser solto), para não comer o começo nem o fim das palavras.
 * - A sensibilidade automática segue o piso de ruído: desce depressa quando o ambiente fica mais
 *   quieto, sobe devagar (3 dB por segundo) quando fica mais barulhento, e o limiar é o piso mais
 *   [`AUTO_MARGIN_DB`], entre [`AUTO_MIN_DB`] e [`AUTO_MAX_DB`]. Com o portão aberto, o piso sobe
 *   bem mais devagar (1 dB por segundo): a voz quase não conta como ruído, e as pausas entre as
 *   frases o trazem de volta depressa. Mas um ruído constante acima do limiar (um ventilador
 *   ligado de repente) não deixa o portão aberto para sempre: em alguns segundos o piso o alcança.
 */

export type InputMode = "voice" | "ptt";

export interface GateParams {
	mode: InputMode;
	/** Sensibilidade automática (só na detecção de voz). */
	auto: boolean;
	/** O limiar da sensibilidade manual, em dBFS (-100 a 0). */
	thresholdDb: number;
	/** O atalho do pressionar para falar está apertado. */
	held: boolean;
}

export const OPEN_MS = 10;
export const HOLD_MS = 300;
export const AUTO_MARGIN_DB = 15;
export const AUTO_MIN_DB = -60;
export const AUTO_MAX_DB = -25;
/** O piso com que o automático começa: um quarto quieto. */
export const INITIAL_FLOOR_DB = -65;
/** O nível de silêncio total, para não ter `-Infinity`. */
export const SILENCE_DB = -100;

/** Quanto o piso sobe por segundo, quando o ambiente fica mais barulhento. */
const FLOOR_RISE_DB_PER_S = 3;
/** Quanto o piso sobe por segundo com o portão aberto. */
const FLOOR_RISE_OPEN_DB_PER_S = 1;
/** Em quanto tempo o piso alcança um ambiente mais quieto. */
const FLOOR_FALL_MS = 200;

/** O nível de um bloco de amostras (RMS), em dBFS, de [`SILENCE_DB`] a 0. */
export function levelDb(samples: ArrayLike<number>): number {
	if (samples.length === 0) return SILENCE_DB;
	let sum = 0;
	for (let i = 0; i < samples.length; i++) sum += samples[i] * samples[i];
	const rms = Math.sqrt(sum / samples.length);
	if (rms <= 0) return SILENCE_DB;
	return Math.max(SILENCE_DB, Math.min(0, 20 * Math.log10(rms)));
}

export class GateState {
	open = false;
	floorDb = INITIAL_FLOOR_DB;
	/** Há quanto tempo a voz está acima do limiar, sem cair. */
	private aboveMs = 0;
	/** Há quanto tempo a voz caiu (ou o atalho foi solto). */
	private belowMs = Number.POSITIVE_INFINITY;

	/** O limiar de agora, para a régua da sensibilidade. */
	threshold(params: GateParams): number {
		if (!params.auto) return params.thresholdDb;
		return Math.min(
			AUTO_MAX_DB,
			Math.max(AUTO_MIN_DB, this.floorDb + AUTO_MARGIN_DB),
		);
	}

	/** Um bloco de `blockMs` com o nível `level`: devolve se o portão está aberto depois dele. */
	step(level: number, blockMs: number, params: GateParams): boolean {
		if (params.mode === "ptt") {
			if (params.held) {
				this.open = true;
				this.belowMs = 0;
			} else {
				this.closeAfterHold(blockMs);
			}
			return this.open;
		}

		this.trackFloor(level, blockMs);
		if (level >= this.threshold(params)) {
			this.aboveMs += blockMs;
			this.belowMs = 0;
			if (this.aboveMs >= OPEN_MS) this.open = true;
		} else {
			this.aboveMs = 0;
			this.closeAfterHold(blockMs);
		}
		return this.open;
	}

	private closeAfterHold(blockMs: number) {
		this.belowMs += blockMs;
		if (this.belowMs >= HOLD_MS) this.open = false;
	}

	private trackFloor(level: number, blockMs: number) {
		if (level < this.floorDb) {
			this.floorDb += (level - this.floorDb) * Math.min(1, blockMs / FLOOR_FALL_MS);
		} else {
			const rise = this.open ? FLOOR_RISE_OPEN_DB_PER_S : FLOOR_RISE_DB_PER_S;
			this.floorDb = Math.min(level, this.floorDb + (rise * blockMs) / 1000);
		}
	}
}
