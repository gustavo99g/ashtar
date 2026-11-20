/*
 * O Testar conexão (v0.6, decisão 20): o ping até o servidor de voz, o caminho que a voz usa e se dá
 * para mandar som. Fora de uma sala, o teste entra numa sala só da pessoa (`teste:{id}`, com o token
 * de 1 minuto da API) e publica um som mudo por alguns segundos; numa sala, lê a conexão que já
 * existe. Aqui só a leitura do `getStats`.
 */
import { pingFromStats } from "../../dock/model/ping";

/** `direct`: UDP, o caminho bom. `fallback`: TCP ou o servidor de reserva (TURN), mais lento. */
export type VoiceRoute = "direct" | "fallback";

export interface ConnectionTestResult {
	/** Ida e volta até o servidor, em ms. */
	ping: number | null;
	route: VoiceRoute | null;
	/** O som saiu: o servidor recebeu pacotes. */
	sending: boolean;
}

/** O caminho do par de candidatos que o WebRTC escolheu. */
export function routeFromStats(report: RTCStatsReport): VoiceRoute | null {
	const stats = [...report.values()] as Record<string, unknown>[];
	const byId = new Map(stats.map((entry) => [entry.id, entry]));
	const transport = stats.find(
		(entry) => entry.type === "transport" && entry.selectedCandidatePairId,
	);
	const pair =
		(transport ? byId.get(transport.selectedCandidatePairId) : undefined) ??
		stats.find(
			(entry) =>
				entry.type === "candidate-pair" &&
				entry.nominated === true &&
				entry.state === "succeeded",
		);
	const local = pair ? byId.get(pair.localCandidateId) : undefined;
	if (!local) return null;
	if (local.candidateType === "relay" || local.protocol === "tcp") {
		return "fallback";
	}
	return "direct";
}

/** Quantos pacotes de áudio saíram. */
export function packetsSent(report: RTCStatsReport): number {
	let sent = 0;
	for (const entry of report.values() as Iterable<Record<string, unknown>>) {
		if (entry.type === "outbound-rtp" && typeof entry.packetsSent === "number") {
			sent += entry.packetsSent;
		}
	}
	return sent;
}

export function readResult(report: RTCStatsReport): ConnectionTestResult {
	return {
		ping: pingFromStats(report),
		route: routeFromStats(report),
		sending: packetsSent(report) > 0,
	};
}
