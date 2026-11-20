import { ConnectionQuality } from "livekit-client";
import { describe, expect, it } from "vitest";
import { trouble } from "../../members/hooks/useLiveMembers";
import { encodeVoiceState, parseVoiceState } from "../model/voiceState";
import {
	connectionLabel,
	encodeVoiceStats,
	lossFromStats,
	parseVoiceStats,
} from "../model/voiceStats";

function report(entries: Record<string, unknown>[]): RTCStatsReport {
	return new Map(
		entries.map((entry, i) => [String(i), { id: String(i), ...entry }]),
	) as unknown as RTCStatsReport;
}

describe("os números da conexão", () => {
	it("vão e voltam pela mensagem, sem se confundir com o surdo", () => {
		const payload = encodeVoiceStats({ ping: 42, loss: 1.5 });
		expect(parseVoiceStats(payload)).toEqual({ ping: 42, loss: 1.5 });
		// O app antigo lê a mensagem como surdo e a ignora.
		expect(parseVoiceState(payload)).toBeNull();
		expect(parseVoiceStats(encodeVoiceState({ deafened: true }))).toBeNull();
		expect(
			parseVoiceStats(new TextEncoder().encode('{"stats":{"ping":"x"}}')),
		).toEqual({ ping: null, loss: null });
	});

	it("a perda vem do que o servidor diz ter perdido; sem isso, do que chegou", () => {
		expect(
			lossFromStats(report([{ type: "remote-inbound-rtp", fractionLost: 0.123 }])),
		).toBe(12.3);
		expect(
			lossFromStats(
				report([{ type: "inbound-rtp", packetsLost: 5, packetsReceived: 95 }]),
			),
		).toBe(5);
		expect(lossFromStats(report([]))).toBeNull();
	});

	it("o texto é o pior entre a perda e o ping", () => {
		expect(connectionLabel({ ping: 40, loss: 0 })).toBe("Boa");
		expect(connectionLabel({ ping: 200, loss: 0 })).toBe("Instável");
		expect(connectionLabel({ ping: 40, loss: 12 })).toBe("Ruim");
		expect(connectionLabel({ ping: null, loss: null })).toBe("Boa");
	});

	it("só a qualidade ruim do LiveKit vira marca", () => {
		expect(trouble(ConnectionQuality.Excellent)).toBeUndefined();
		expect(trouble(ConnectionQuality.Good)).toBeUndefined();
		expect(trouble(ConnectionQuality.Poor)).toBe("unstable");
		expect(trouble(ConnectionQuality.Lost)).toBe("bad");
	});
});
