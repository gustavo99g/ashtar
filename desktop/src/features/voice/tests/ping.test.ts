import { describe, expect, it } from "vitest";
import { pingFromStats, pingQuality } from "../ping";

function report(...entries: Record<string, unknown>[]): RTCStatsReport {
	return new Map(
		entries.map((entry) => [entry.id as string, entry]),
	) as unknown as RTCStatsReport;
}

describe("pingFromStats", () => {
	it("usa o par que o transporte escolheu", () => {
		const stats = report(
			{ id: "T1", type: "transport", selectedCandidatePairId: "CP2" },
			{
				id: "CP1",
				type: "candidate-pair",
				nominated: true,
				state: "succeeded",
				currentRoundTripTime: 0.3,
			},
			{
				id: "CP2",
				type: "candidate-pair",
				nominated: true,
				state: "succeeded",
				currentRoundTripTime: 0.0421,
			},
		);
		expect(pingFromStats(stats)).toBe(42);
	});

	it("sem o transporte, usa o par nomeado que deu certo", () => {
		const stats = report(
			{
				id: "CP1",
				type: "candidate-pair",
				nominated: false,
				state: "failed",
				currentRoundTripTime: 0.9,
			},
			{
				id: "CP2",
				type: "candidate-pair",
				nominated: true,
				state: "succeeded",
				currentRoundTripTime: 0.08,
			},
		);
		expect(pingFromStats(stats)).toBe(80);
	});

	it("sem RTT ainda, não tem ping", () => {
		expect(pingFromStats(report())).toBeNull();
		expect(
			pingFromStats(
				report({
					id: "CP1",
					type: "candidate-pair",
					nominated: true,
					state: "succeeded",
				}),
			),
		).toBeNull();
	});
});

describe("pingQuality", () => {
	it("separa boa, média e ruim", () => {
		expect(pingQuality(42)).toBe("boa");
		expect(pingQuality(150)).toBe("boa");
		expect(pingQuality(151)).toBe("média");
		expect(pingQuality(300)).toBe("média");
		expect(pingQuality(301)).toBe("ruim");
	});
});
