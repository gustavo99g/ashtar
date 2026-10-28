/*
 * O ping do painel "Voz conectada": o tempo de ida e volta (RTT) do par de candidatos que o
 * WebRTC escolheu, lido do `getStats` de uma trilha da chamada (o microfone, ou o áudio de alguém
 * quando o microfone nunca abriu).
 */

/** O ping em milissegundos, ou `null` se o relatório ainda não tem um par escolhido com RTT. */
export function pingFromStats(report: RTCStatsReport): number | null {
	const stats = [...report.values()] as Record<string, unknown>[];
	const byId = new Map(stats.map((entry) => [entry.id, entry]));

	// O transporte aponta o par em uso; sem ele, vale o par nomeado que deu certo.
	const transport = stats.find(
		(entry) => entry.type === "transport" && entry.selectedCandidatePairId,
	);
	const selected = transport
		? byId.get(transport.selectedCandidatePairId)
		: undefined;
	const pair =
		selected ??
		stats.find(
			(entry) =>
				entry.type === "candidate-pair" &&
				entry.nominated === true &&
				entry.state === "succeeded",
		);

	const rtt = pair?.currentRoundTripTime;
	return typeof rtt === "number" && Number.isFinite(rtt)
		? Math.round(rtt * 1000)
		: null;
}

export type PingQuality = "boa" | "média" | "ruim";

/** Até 150 ms a conexão é boa; até 300 ms, média; acima, ruim. */
export function pingQuality(ms: number): PingQuality {
	if (ms <= 150) return "boa";
	if (ms <= 300) return "média";
	return "ruim";
}
