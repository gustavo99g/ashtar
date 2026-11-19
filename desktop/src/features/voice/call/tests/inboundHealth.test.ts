import { describe, expect, it } from "vitest";
import {
	formatBitrate,
	formatResolution,
	type InboundSample,
	inboundHealth,
	readInbound,
	summarize,
} from "../model/inboundHealth";

function sample(change: Partial<InboundSample> = {}): InboundSample {
	return {
		at: 0,
		width: 1920,
		height: 1080,
		fps: 59.6,
		framesDropped: 0,
		packetsLost: 0,
		packetsReceived: 1000,
		bytesReceived: 1_000_000,
		bufferMs: 40,
		rttMs: 60,
		...change,
	};
}

describe("readInbound", () => {
	it("acha o vídeo que chega e o par de conexão em uso", () => {
		const report = new Map<string, unknown>([
			["a", { type: "inbound-rtp", kind: "audio", packetsLost: 99 }],
			[
				"v",
				{
					type: "inbound-rtp",
					kind: "video",
					frameWidth: 1280,
					frameHeight: 720,
					framesPerSecond: 30,
					framesDropped: 2,
					packetsLost: 5,
					packetsReceived: 500,
					bytesReceived: 4000,
					jitterBufferDelay: 3,
					jitterBufferEmittedCount: 60,
				},
			],
			["p", { type: "candidate-pair", nominated: true, state: "succeeded", currentRoundTripTime: 0.08 }],
		]);
		expect(readInbound(report, 7)).toEqual({
			at: 7,
			width: 1280,
			height: 720,
			fps: 30,
			framesDropped: 2,
			packetsLost: 5,
			packetsReceived: 500,
			bytesReceived: 4000,
			bufferMs: 50,
			rttMs: 80,
		});
	});

	it("sem vídeo, nada", () => {
		expect(readInbound(new Map(), 0)).toBeNull();
	});
});

describe("summarize", () => {
	it("conta a perda, os descartes e a taxa pela diferença", () => {
		const summary = summarize(
			sample(),
			sample({
				at: 2000,
				packetsLost: 10,
				packetsReceived: 1190,
				framesDropped: 3,
				bytesReceived: 2_000_000,
			}),
		);
		expect(summary).toMatchObject({
			fps: 60,
			kbps: 4000,
			lossPercent: 5,
			dropped: 3,
			delayMs: 70,
		});
	});

	it("sem a leitura anterior, nada de perda nem taxa", () => {
		expect(summarize(null, sample())).toMatchObject({
			kbps: 0,
			lossPercent: 0,
			dropped: 0,
		});
	});
});

describe("inboundHealth", () => {
	const ok = summarize(sample(), sample({ at: 2000, packetsReceived: 1200 }));

	it("na ordem: pausada, perda, computador, atraso", () => {
		expect(inboundHealth(null, false)).toBe("measuring");
		expect(inboundHealth(ok, true)).toBe("paused");
		expect(inboundHealth({ ...ok, lossPercent: 3, dropped: 4 }, false)).toBe("loss");
		expect(inboundHealth({ ...ok, dropped: 4 }, false)).toBe("computer");
		expect(inboundHealth({ ...ok, delayMs: 900 }, false)).toBe("delay");
		expect(inboundHealth(ok, false)).toBe("ok");
	});

	it("fps baixo sem perda não é problema: já chega assim", () => {
		expect(inboundHealth({ ...ok, fps: 4 }, false)).toBe("ok");
	});
});

describe("textos", () => {
	it("resolução e taxa", () => {
		expect(formatResolution({ ...summarize(null, sample()) })).toBe("1920 × 1080");
		expect(formatResolution({ ...summarize(null, sample({ width: 0 })) })).toBe("—");
		expect(formatBitrate(4250)).toBe("4,3 Mbps");
		expect(formatBitrate(850)).toBe("850 kbps");
	});
});
