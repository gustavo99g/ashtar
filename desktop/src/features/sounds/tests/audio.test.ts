import { describe, expect, it } from "vitest";
import {
	clampClip,
	encodeWav,
	mixToMono,
	nameFromFile,
	NORMALIZED_PEAK,
	peakOf,
	peaks,
	renderClip,
	resample,
	SAMPLE_RATE,
	soundFileProblem,
} from "../model/audio";
import { soundNameProblem } from "../components/SoundEditor";

const base = { gainDb: 0, normalize: false, fadeIn: false, fadeOut: false };

describe("o editor de sons", () => {
	it("aceita só arquivo de som de até 10 MB", () => {
		const file = (name: string, type: string, size = 10) =>
			new File([new Uint8Array(size)], name, { type });
		expect(soundFileProblem(file("a.mp3", "audio/mpeg"))).toBeNull();
		expect(soundFileProblem(file("a.ogg", ""))).toBeNull();
		expect(soundFileProblem(file("a.png", "image/png"))).toMatch(/arquivo de som/);
		expect(soundFileProblem(file("a.wav", "audio/wav", 10 * 1024 * 1024 + 1))).toMatch(
			/10 MB/,
		);
		expect(nameFromFile("buzina_alta-2.mp3")).toBe("buzina alta 2");
		expect(soundNameProblem("  ")).toMatch(/nome/);
		expect(soundNameProblem("x".repeat(25))).toMatch(/24/);
		expect(soundNameProblem("Buzina")).toBeNull();
	});

	it("mistura os canais e troca a taxa", () => {
		const mono = mixToMono([new Float32Array([1, 0]), new Float32Array([0, 1])]);
		expect(Array.from(mono)).toEqual([0.5, 0.5]);
		const up = resample(new Float32Array(24_000), 24_000);
		expect(up.length).toBe(SAMPLE_RATE);
		const down = resample(new Float32Array(44_100 * 2), 44_100);
		expect(down.length).toBe(SAMPLE_RATE * 2);
	});

	it("o trecho fica dentro do arquivo e em até 5 s", () => {
		expect(clampClip(1, 9, 8)).toEqual({ start: 1, end: 6 });
		expect(clampClip(-1, 2, 8)).toEqual({ start: 0, end: 2 });
		expect(clampClip(3, 2, 8).end).toBeCloseTo(3.1);
		expect(clampClip(0, 5, 2)).toEqual({ start: 0, end: 2 });
	});

	it("corta, aplica o volume, iguala e suaviza", () => {
		const samples = new Float32Array(SAMPLE_RATE * 8).fill(0.25);
		const clip = renderClip(samples, { ...base, start: 1, end: 7 });
		expect(clip.length).toBe(SAMPLE_RATE * 5);
		const louder = renderClip(samples, { ...base, start: 0, end: 1, gainDb: 6 });
		expect(louder[100]).toBeCloseTo(0.25 * 10 ** (6 / 20), 4);
		const even = renderClip(samples, { ...base, start: 0, end: 1, normalize: true });
		expect(peakOf(even)).toBeCloseTo(NORMALIZED_PEAK, 4);
		const faded = renderClip(samples, {
			...base,
			start: 0,
			end: 1,
			fadeIn: true,
			fadeOut: true,
		});
		expect(faded[0]).toBe(0);
		expect(faded[faded.length - 1]).toBe(0);
		expect(faded[SAMPLE_RATE / 2]).toBeCloseTo(0.25);
	});

	it("gera o WAV mono de 16 bits: 5 s dão uns 470 KB", () => {
		const wav = encodeWav(new Float32Array(SAMPLE_RATE * 5).fill(0.5));
		expect(wav.length).toBe(44 + SAMPLE_RATE * 5 * 2);
		expect(Math.round(wav.length / 1024)).toBe(469);
		const view = new DataView(wav.buffer);
		const text = (at: number) =>
			String.fromCharCode(...wav.subarray(at, at + 4));
		expect(text(0)).toBe("RIFF");
		expect(text(8)).toBe("WAVE");
		expect(view.getUint16(22, true)).toBe(1);
		expect(view.getUint32(24, true)).toBe(SAMPLE_RATE);
		expect(view.getUint16(34, true)).toBe(16);
		expect(view.getUint32(40, true)).toBe(SAMPLE_RATE * 10);
		expect(view.getInt16(44, true)).toBe(Math.round(0.5 * 0x7fff));
	});

	it("as barras da onda são os picos de cada pedaço", () => {
		const samples = new Float32Array([0, 0.5, -1, 0.25]);
		expect(peaks(samples, 2)).toEqual([0.5, 1]);
		expect(peaks(new Float32Array(), 10)).toEqual([]);
	});
});
