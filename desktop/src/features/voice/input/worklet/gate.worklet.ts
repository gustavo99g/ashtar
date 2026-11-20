/**
 * O AudioWorklet do portão (ADR 0029). Roda na thread de áudio, sem ser freada quando a janela do
 * Ashtar está atrás do jogo (um `setInterval` na janela seria). Cada bloco de 128 amostras: mede o
 * nível, pergunta ao [`GateState`] se passa, e aplica o ganho com uma rampa curta (sem clique).
 *
 * Fala com a página pelo `port`: recebe os [`GateParams`] (`{ params }`) e manda, umas 20 vezes por
 * segundo, `{ level, open, threshold }` para o medidor e a régua da sensibilidade.
 *
 * Carregado pelo `chain.ts` com `?worker&url`: o Vite empacota este arquivo (e o `gate.ts`) num
 * script só.
 */
import { type GateParams, GateState, levelDb } from "../model/gate";

// O escopo do AudioWorklet não está no `lib` do TypeScript.
declare const sampleRate: number;
declare function registerProcessor(name: string, processor: unknown): void;
declare class AudioWorkletProcessor {
	readonly port: MessagePort;
}

/** De quantos em quantos milissegundos o nível vai para a página. */
const REPORT_MS = 50;
/** Em quantas amostras o ganho chega a ~63% do alvo: uns 2 ms a 48 kHz. */
const RAMP_SAMPLES = 96;

class AshtarGate extends AudioWorkletProcessor {
	private readonly state = new GateState();
	private params: GateParams = {
		mode: "voice",
		auto: true,
		thresholdDb: -50,
		held: false,
	};
	private gain = 0;
	private sinceReport = 0;
	private peak = -100;

	constructor() {
		super();
		this.port.onmessage = (event: MessageEvent<{ params?: GateParams }>) => {
			if (event.data.params) this.params = event.data.params;
		};
	}

	process(inputs: Float32Array[][], outputs: Float32Array[][]): boolean {
		const input = inputs[0]?.[0];
		const output = outputs[0]?.[0];
		if (!output) return true;
		if (!input) {
			output.fill(0);
			return true;
		}

		const blockMs = (input.length / sampleRate) * 1000;
		const level = levelDb(input);
		const open = this.state.step(level, blockMs, this.params);
		const target = open ? 1 : 0;
		const k = 1 / RAMP_SAMPLES;
		for (let i = 0; i < input.length; i++) {
			this.gain += (target - this.gain) * k;
			output[i] = input[i] * this.gain;
		}
		for (let c = 1; c < outputs[0].length; c++) outputs[0][c].set(output);

		this.peak = Math.max(this.peak, level);
		this.sinceReport += blockMs;
		if (this.sinceReport >= REPORT_MS) {
			this.port.postMessage({
				level: this.peak,
				open,
				threshold: this.state.threshold(this.params),
			});
			this.sinceReport = 0;
			this.peak = -100;
		}
		return true;
	}
}

registerProcessor("ashtar-gate", AshtarGate);
