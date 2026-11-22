/**
 * Como a transmissão está chegando para quem assiste (ADR 0024): os números do popover e a frase do
 * topo, no estilo do `health.ts` de quem transmite.
 *
 * Os números vêm do `getRTCStatsReport` da trilha assinada (`useInboundShareStats`), um a cada 2 s.
 * A perda e os quadros descartados contam pela diferença entre duas leituras, e não pelo total desde
 * o começo: o que importa é o agora.
 *
 * O fps sozinho não diz nada de errado: o caminho nativo só codifica imagens novas (ADR 0018), e com a
 * tela parada ele cai. Por isso, sem perda e sem atraso, a frase é "chega como sai": se a imagem está
 * fraca, já chega assim de quem transmite.
 */

/** Uma leitura da trilha. */
export interface InboundSample {
	/** `Date.now()` da leitura. */
	at: number;
	width: number;
	height: number;
	fps: number;
	framesDropped: number;
	packetsLost: number;
	packetsReceived: number;
	bytesReceived: number;
	/** O atraso médio do buffer de recepção, em ms. */
	bufferMs: number;
	/** A ida e volta até o servidor, em ms, quando se sabe. */
	rttMs: number | null;
}

/** O que o popover mostra: a última leitura e o que mudou desde a anterior. */
export interface InboundSummary {
	width: number;
	height: number;
	fps: number;
	kbps: number;
	/** De 0 a 100. */
	lossPercent: number;
	/** Quadros descartados por este computador desde a leitura anterior. */
	dropped: number;
	/** O atraso: o buffer mais metade da ida e volta, em ms. */
	delayMs: number;
}

export type InboundHealth = "measuring" | "paused" | "loss" | "computer" | "delay" | "ok";

/** Acima disso a conexão de quem assiste está perdendo pacotes. */
const LOSS_LIMIT = 2;
/** Acima disso a imagem chega atrasada. */
const DELAY_LIMIT = 400;

function numberOf(value: unknown): number {
	return typeof value === "number" && Number.isFinite(value) ? value : 0;
}

/** Tira do relatório a trilha de vídeo que chega e o par de conexão em uso. `null` sem vídeo. */
export function readInbound(
	report: Iterable<[string, unknown]> | { forEach: RTCStatsReport["forEach"] },
	at: number,
): InboundSample | null {
	const entries: Record<string, unknown>[] = [];
	if ("forEach" in report) {
		report.forEach((stat: unknown) => entries.push(stat as Record<string, unknown>));
	} else {
		for (const [, stat] of report) entries.push(stat as Record<string, unknown>);
	}
	const video = entries.find(
		(stat) => stat.type === "inbound-rtp" && (stat.kind ?? stat.mediaType) === "video",
	);
	if (!video) return null;
	const pair = entries.find(
		(stat) =>
			stat.type === "candidate-pair" &&
			(stat.nominated === true || stat.selected === true) &&
			stat.state === "succeeded",
	);
	const emitted = numberOf(video.jitterBufferEmittedCount);
	const rtt = pair ? numberOf(pair.currentRoundTripTime) : 0;
	return {
		at,
		width: numberOf(video.frameWidth),
		height: numberOf(video.frameHeight),
		fps: numberOf(video.framesPerSecond),
		framesDropped: numberOf(video.framesDropped),
		packetsLost: numberOf(video.packetsLost),
		packetsReceived: numberOf(video.packetsReceived),
		bytesReceived: numberOf(video.bytesReceived),
		bufferMs:
			emitted > 0 ? (numberOf(video.jitterBufferDelay) / emitted) * 1000 : 0,
		rttMs: rtt > 0 ? rtt * 1000 : null,
	};
}

/** O resumo entre a leitura anterior e a última (sem a anterior, só o que a última já diz). */
export function summarize(
	previous: InboundSample | null,
	last: InboundSample,
): InboundSummary {
	const seconds = previous ? (last.at - previous.at) / 1000 : 0;
	const lost = previous ? Math.max(0, last.packetsLost - previous.packetsLost) : 0;
	const received = previous
		? Math.max(0, last.packetsReceived - previous.packetsReceived)
		: 0;
	const bytes = previous ? Math.max(0, last.bytesReceived - previous.bytesReceived) : 0;
	return {
		width: last.width,
		height: last.height,
		fps: Math.round(last.fps),
		kbps: seconds > 0 ? Math.round((bytes * 8) / 1000 / seconds) : 0,
		lossPercent:
			lost + received > 0 ? Math.round((lost / (lost + received)) * 1000) / 10 : 0,
		dropped: previous ? Math.max(0, last.framesDropped - previous.framesDropped) : 0,
		delayMs: Math.round(last.bufferMs + (last.rttMs ?? 0) / 2),
	};
}

/** O aviso do topo do popover. */
export function inboundHealth(
	summary: InboundSummary | null,
	paused: boolean,
): InboundHealth {
	if (paused) return "paused";
	if (!summary) return "measuring";
	if (summary.lossPercent > LOSS_LIMIT) return "loss";
	if (summary.dropped > 0) return "computer";
	if (summary.delayMs > DELAY_LIMIT) return "delay";
	return "ok";
}

export const INBOUND_SENTENCES: Record<InboundHealth, string> = {
	measuring: "Medindo…",
	paused: "A transmissão está pausada por quem transmite.",
	loss: "Sua conexão está perdendo pacotes: a imagem pode travar ou borrar.",
	computer: "Seu computador está descartando quadros ao mostrar a transmissão.",
	delay: "A imagem está chegando com atraso.",
	ok: "Chega como sai de quem transmite. Se a imagem está fraca, já chega assim.",
};

/** "1920 × 1080", ou um traço antes do primeiro quadro. */
export function formatResolution(summary: InboundSummary): string {
	return summary.width > 0 ? `${summary.width} × ${summary.height}` : "—";
}

/** "4,2 Mbps" ou "850 kbps". */
export function formatBitrate(kbps: number): string {
	return kbps >= 1000
		? `${(Math.round(kbps / 100) / 10).toString().replace(".", ",")} Mbps`
		: `${kbps} kbps`;
}
