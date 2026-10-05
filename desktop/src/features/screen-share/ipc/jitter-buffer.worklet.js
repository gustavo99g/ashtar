/**
 * Jitter buffer do áudio do compartilhamento. Roda na thread de áudio do navegador.
 *
 * Recebe blocos de f32 estéreo intercalado (L, R, L, R...) pela `port` e os toca num ritmo
 * constante. Os blocos chegam do Rust em rajadas irregulares; o buffer absorve a variação:
 *
 * - Acumula 50 ms antes de começar a tocar (e de novo sempre que esvazia).
 * - Se passar de 150 ms guardados, descarta os mais antigos e volta a 50 ms, para a latência
 *   não crescer sem limite quando o relógio do Rust anda um pouco mais rápido que o daqui.
 * - `process()` não aloca nada: o anel é criado uma vez, no construtor.
 */

const CHANNELS = 2;
const CAPACITY_FRAMES = sampleRate; // 1 segundo
const START_FRAMES = Math.round(sampleRate * 0.05); // 2.400 frames a 48 kHz
const MAX_FRAMES = Math.round(sampleRate * 0.15); // 7.200 frames a 48 kHz

class JitterBufferProcessor extends AudioWorkletProcessor {
	constructor() {
		super();

		this.ring = new Float32Array(CAPACITY_FRAMES * CHANNELS);
		this.readFrame = 0; // próximo frame a tocar
		this.available = 0; // frames guardados
		this.buffering = true;

		// Estatísticas desde o último pedido de "stats".
		this.underruns = 0;
		this.droppedFrames = 0;

		this.port.onmessage = (event) => this.onMessage(event.data);
	}

	onMessage(data) {
		if (data === "stats") {
			this.port.postMessage({
				bufferedMs: (this.available / sampleRate) * 1000,
				underruns: this.underruns,
				droppedFrames: this.droppedFrames,
			});
			this.underruns = 0;
			this.droppedFrames = 0;
			return;
		}

		if (data instanceof Float32Array) {
			this.write(data);
		}
	}

	write(samples) {
		let first = 0;
		let frames = Math.floor(samples.length / CHANNELS);

		// Um bloco maior que o anel inteiro: só os últimos frames cabem.
		if (frames > CAPACITY_FRAMES) {
			first = frames - CAPACITY_FRAMES;
			this.droppedFrames += first;
			frames = CAPACITY_FRAMES;
		}

		// Abre espaço descartando os mais antigos.
		const overflow = this.available + frames - CAPACITY_FRAMES;
		if (overflow > 0) {
			this.discard(overflow);
		}

		let writeFrame = (this.readFrame + this.available) % CAPACITY_FRAMES;
		for (let i = 0; i < frames; i++) {
			const src = (first + i) * CHANNELS;
			const dst = writeFrame * CHANNELS;
			this.ring[dst] = samples[src];
			this.ring[dst + 1] = samples[src + 1];
			writeFrame = writeFrame + 1 === CAPACITY_FRAMES ? 0 : writeFrame + 1;
		}
		this.available += frames;

		if (this.available > MAX_FRAMES) {
			this.discard(this.available - START_FRAMES);
		}
	}

	discard(frames) {
		this.readFrame = (this.readFrame + frames) % CAPACITY_FRAMES;
		this.available -= frames;
		this.droppedFrames += frames;
	}

	process(_inputs, outputs) {
		const left = outputs[0][0];
		const right = outputs[0][1];
		const quantum = left.length; // 128 frames

		if (this.buffering) {
			if (this.available < START_FRAMES) {
				left.fill(0);
				right.fill(0);
				return true;
			}
			this.buffering = false;
		}

		const frames = Math.min(quantum, this.available);
		let frame = this.readFrame;
		for (let i = 0; i < frames; i++) {
			const src = frame * CHANNELS;
			left[i] = this.ring[src];
			right[i] = this.ring[src + 1];
			frame = frame + 1 === CAPACITY_FRAMES ? 0 : frame + 1;
		}
		this.readFrame = frame;
		this.available -= frames;

		// Esvaziou no meio do bloco: completa com silêncio e volta a acumular.
		if (frames < quantum) {
			left.fill(0, frames);
			right.fill(0, frames);
			this.buffering = true;
			this.underruns += 1;
		}

		return true;
	}
}

registerProcessor("jitter-buffer", JitterBufferProcessor);
