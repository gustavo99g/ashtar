/*
 * Os números da conexão de cada um (v0.6, decisão 15): o ping até o servidor e a perda de pacotes,
 * que cada app mede na própria conexão e manda para a sala a cada 5 segundos, no mesmo tópico do
 * surdo (`voiceState.ts`). O app antigo ignora a mensagem (não tem `deafened`), e o novo, sem a
 * mensagem de alguém, mostra só o ícone da qualidade que o LiveKit já dá.
 */

export const VOICE_STATS_EVERY_MS = 5_000;

export interface VoiceStats {
	/** Ida e volta até o servidor, em ms. */
	ping: number | null;
	/** A perda de pacotes, em %. */
	loss: number | null;
}

const encoder = new TextEncoder();
const decoder = new TextDecoder();

export function encodeVoiceStats(stats: VoiceStats): Uint8Array<ArrayBuffer> {
	return encoder.encode(JSON.stringify({ stats }));
}

function number(value: unknown): number | null {
	return typeof value === "number" && Number.isFinite(value) && value >= 0
		? value
		: null;
}

/** Lê os números de outro app. Qualquer coisa fora do formato vira `null`. */
export function parseVoiceStats(payload: Uint8Array): VoiceStats | null {
	try {
		const parsed: unknown = JSON.parse(decoder.decode(payload));
		if (typeof parsed !== "object" || parsed === null) return null;
		const stats = (parsed as { stats?: unknown }).stats;
		if (typeof stats !== "object" || stats === null) return null;
		const { ping, loss } = stats as Record<string, unknown>;
		return { ping: number(ping), loss: number(loss) };
	} catch {
		return null;
	}
}

/**
 * A perda de pacotes em %, do relatório do `getStats` da trilha: a fração que o servidor diz ter
 * perdido do que mandamos (`remote-inbound-rtp`, a do último intervalo); sem ela, a do que
 * recebemos (`inbound-rtp`, desde o começo).
 */
export function lossFromStats(report: RTCStatsReport): number | null {
	const stats = [...report.values()] as Record<string, unknown>[];
	const remote = stats.find(
		(entry) =>
			entry.type === "remote-inbound-rtp" &&
			typeof entry.fractionLost === "number",
	);
	if (remote) return round((remote.fractionLost as number) * 100);
	const inbound = stats.find((entry) => entry.type === "inbound-rtp");
	const lost = number(inbound?.packetsLost);
	const received = number(inbound?.packetsReceived);
	if (lost === null || received === null || lost + received === 0) return null;
	return round((lost / (lost + received)) * 100);
}

function round(value: number): number {
	return Math.round(value * 10) / 10;
}

export type ConnectionLabel = "Boa" | "Instável" | "Ruim";

/** O texto da seção Conexão do cartão: pela perda e pelo ping, o pior dos dois. */
export function connectionLabel(stats: VoiceStats): ConnectionLabel {
	const loss = stats.loss ?? 0;
	const ping = stats.ping ?? 0;
	if (loss >= 10 || ping > 300) return "Ruim";
	if (loss >= 3 || ping > 150) return "Instável";
	return "Boa";
}
