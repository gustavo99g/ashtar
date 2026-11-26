/**
 * O editor de sons (v0.9, ADR 0037, decisão 22), a parte sem tela: o arquivo vira amostras mono de
 * 48 kHz, o trecho escolhido ganha o volume, o "Igualar volume" e as suavizações, e sai em WAV mono
 * de 16 bits. Não há codificador no app: o WAV é só o cabeçalho e as amostras.
 *
 * Decodificar (MP3, OGG, WAV) é com o Web Audio; o resto são contas sobre `Float32Array`, que os
 * testes conferem sem navegador.
 */

export const SAMPLE_RATE = 48_000;
/** O trecho mais longo que sobe. A API confere de novo, pela duração do WAV. */
export const MAX_CLIP_S = 5;
/** O maior arquivo que o editor abre, antes do corte. */
export const MAX_SOURCE_BYTES = 10 * 1024 * 1024;
export const MIN_GAIN_DB = -12;
export const MAX_GAIN_DB = 6;
/** O pico do "Igualar volume": um pouco abaixo do máximo, para não estourar. */
export const NORMALIZED_PEAK = 0.89;
/** A suavização do início e do fim. */
export const FADE_S = 0.05;
/** O trecho mais curto que dá para escolher. */
export const MIN_CLIP_S = 0.1;

export interface ClipOptions {
	/** Em segundos, dentro do arquivo. */
	start: number;
	end: number;
	gainDb: number;
	normalize: boolean;
	fadeIn: boolean;
	fadeOut: boolean;
}

/** O que impede de abrir o arquivo no editor, ou `null`. */
export function soundFileProblem(file: File): string | null {
	const audio =
		file.type.startsWith("audio/") || /\.(mp3|ogg|oga|wav|wave)$/i.test(file.name);
	if (!audio) return "Escolha um arquivo de som (MP3, OGG ou WAV).";
	if (file.size > MAX_SOURCE_BYTES) return "O arquivo passa de 10 MB.";
	return null;
}

/** O nome do som a partir do arquivo: sem a extensão, até 24 letras. */
export function nameFromFile(fileName: string): string {
	return fileName
		.replace(/\.[^.]+$/, "")
		.replace(/[_-]+/g, " ")
		.trim()
		.slice(0, 24);
}

/** Os canais misturados num só. */
export function mixToMono(channels: Float32Array[]): Float32Array {
	if (channels.length === 1) return channels[0];
	const length = Math.min(...channels.map((channel) => channel.length));
	const mono = new Float32Array(length);
	for (const channel of channels) {
		for (let i = 0; i < length; i++) mono[i] += channel[i] / channels.length;
	}
	return mono;
}

/** Troca a taxa de amostragem, por interpolação linear (basta para sons curtos). */
export function resample(
	samples: Float32Array,
	from: number,
	to = SAMPLE_RATE,
): Float32Array {
	if (from === to || samples.length === 0) return samples;
	const length = Math.max(1, Math.round((samples.length * to) / from));
	const out = new Float32Array(length);
	const step = from / to;
	for (let i = 0; i < length; i++) {
		const at = i * step;
		const left = Math.floor(at);
		const right = Math.min(left + 1, samples.length - 1);
		const weight = at - left;
		out[i] = samples[left] * (1 - weight) + samples[right] * weight;
	}
	return out;
}

/** O arquivo em amostras mono de 48 kHz. */
export async function decodeSound(file: Blob): Promise<Float32Array> {
	const bytes = await file.arrayBuffer();
	const context = new AudioContext();
	try {
		const buffer = await context.decodeAudioData(bytes);
		const channels = Array.from({ length: buffer.numberOfChannels }, (_, i) =>
			buffer.getChannelData(i),
		);
		return resample(mixToMono(channels), buffer.sampleRate);
	} finally {
		void context.close();
	}
}

/** O maior valor absoluto. */
export function peakOf(samples: Float32Array): number {
	let peak = 0;
	for (const sample of samples) peak = Math.max(peak, Math.abs(sample));
	return peak;
}

/** O trecho, já cortado no limite de 5 s e no tamanho do arquivo. */
export function clampClip(
	start: number,
	end: number,
	duration: number,
): { start: number; end: number } {
	const s = Math.min(Math.max(0, start), Math.max(0, duration - MIN_CLIP_S));
	const e = Math.min(duration, Math.max(s + MIN_CLIP_S, end), s + MAX_CLIP_S);
	return { start: s, end: e };
}

/** O trecho escolhido, com o volume, o igualar e as suavizações. */
export function renderClip(
	samples: Float32Array,
	options: ClipOptions,
	rate = SAMPLE_RATE,
): Float32Array {
	const duration = samples.length / rate;
	const { start, end } = clampClip(options.start, options.end, duration);
	const clip = samples.slice(Math.round(start * rate), Math.round(end * rate));
	let gain = 10 ** (options.gainDb / 20);
	if (options.normalize) {
		const peak = peakOf(clip);
		if (peak > 0) gain *= NORMALIZED_PEAK / peak;
	}
	const fade = Math.min(Math.round(FADE_S * rate), Math.floor(clip.length / 2));
	for (let i = 0; i < clip.length; i++) {
		let value = clip[i] * gain;
		if (options.fadeIn && i < fade) value *= i / fade;
		if (options.fadeOut && i >= clip.length - fade) {
			value *= (clip.length - 1 - i) / fade;
		}
		clip[i] = Math.max(-1, Math.min(1, value));
	}
	return clip;
}

/** WAV mono de 16 bits: o cabeçalho de 44 bytes e as amostras. */
export function encodeWav(samples: Float32Array, rate = SAMPLE_RATE): Uint8Array {
	const bytes = new Uint8Array(44 + samples.length * 2);
	const view = new DataView(bytes.buffer);
	const text = (at: number, value: string) => {
		for (let i = 0; i < value.length; i++) view.setUint8(at + i, value.charCodeAt(i));
	};
	text(0, "RIFF");
	view.setUint32(4, 36 + samples.length * 2, true);
	text(8, "WAVE");
	text(12, "fmt ");
	view.setUint32(16, 16, true);
	view.setUint16(20, 1, true); // PCM
	view.setUint16(22, 1, true); // mono
	view.setUint32(24, rate, true);
	view.setUint32(28, rate * 2, true);
	view.setUint16(32, 2, true);
	view.setUint16(34, 16, true);
	text(36, "data");
	view.setUint32(40, samples.length * 2, true);
	for (let i = 0; i < samples.length; i++) {
		const value = Math.max(-1, Math.min(1, samples[i]));
		view.setInt16(44 + i * 2, Math.round(value * 0x7fff), true);
	}
	return bytes;
}

/** As barras da onda: o pico de cada pedaço, de 0 a 1. */
export function peaks(samples: Float32Array, bars: number): number[] {
	if (samples.length === 0 || bars <= 0) return [];
	const size = samples.length / bars;
	return Array.from({ length: bars }, (_, bar) => {
		const from = Math.floor(bar * size);
		const to = Math.max(from + 1, Math.floor((bar + 1) * size));
		return peakOf(samples.subarray(from, to));
	});
}

/** "4,5 s". */
export function seconds(value: number): string {
	return `${value.toFixed(1).replace(".", ",")} s`;
}
