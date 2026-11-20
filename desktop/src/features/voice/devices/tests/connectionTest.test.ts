import { describe, expect, it } from "vitest";
import {
	packetsSent,
	readResult,
	routeFromStats,
} from "../model/connectionTest";

function report(entries: Record<string, unknown>[]): RTCStatsReport {
	return new Map(entries.map((entry) => [entry.id, entry])) as unknown as RTCStatsReport;
}

function chosen(local: Record<string, unknown>) {
	return report([
		{ id: "t", type: "transport", selectedCandidatePairId: "p" },
		{
			id: "p",
			type: "candidate-pair",
			localCandidateId: "l",
			currentRoundTripTime: 0.042,
		},
		{ id: "l", type: "local-candidate", ...local },
		{ id: "o", type: "outbound-rtp", packetsSent: 120 },
	]);
}

describe("o Testar conexão", () => {
	it("UDP é o caminho direto; TCP e o servidor de reserva, não", () => {
		expect(routeFromStats(chosen({ protocol: "udp", candidateType: "srflx" }))).toBe(
			"direct",
		);
		expect(routeFromStats(chosen({ protocol: "tcp", candidateType: "host" }))).toBe(
			"fallback",
		);
		expect(routeFromStats(chosen({ protocol: "udp", candidateType: "relay" }))).toBe(
			"fallback",
		);
		expect(routeFromStats(report([]))).toBeNull();
	});

	it("lê o ping e se o som saiu", () => {
		expect(readResult(chosen({ protocol: "udp" }))).toEqual({
			ping: 42,
			route: "direct",
			sending: true,
		});
		expect(packetsSent(report([{ id: "o", type: "outbound-rtp", packetsSent: 0 }]))).toBe(
			0,
		);
	});
});
