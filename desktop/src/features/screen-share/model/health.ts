/**
 * O que o painel da transmissão diz sobre ela (o aviso do topo, o gráfico e o "no ar há"), a partir
 * dos números de cada segundo (`ShareStats`).
 *
 * "Computador no limite" vem dos quadros perdidos, e não do fps: o caminho nativo só codifica
 * imagens novas (ADR 0018), então o fps cai sozinho com a tela parada, sem nada de errado.
 */
import type { Quality, ShareStats } from "@/lib/tauri/commands";
import { networkLimited } from "./presets";

/** Quantos segundos o gráfico do envio guarda. */
export const HISTORY_SECONDS = 60;

/** Quantos segundos para trás contam para "o computador está no limite". */
const DROP_WINDOW = 5;

export type ShareHealth = "paused" | "network" | "computer" | "ok";

/** O aviso do topo, pelos últimos números (o mais novo no fim). */
export function shareHealth(
	history: readonly ShareStats[],
	quality: Quality,
): ShareHealth {
	const last = history[history.length - 1];
	if (!last) return "ok";
	if (last.paused) return "paused";
	const window = history.slice(-(DROP_WINDOW + 1));
	if (window.length > 1 && last.dropped > window[0].dropped) return "computer";
	if (networkLimited(quality, last.targetKbps)) return "network";
	return "ok";
}

/** Os números até `HISTORY_SECONDS`, sem os de outra sessão. */
export function pushStats(
	history: readonly ShareStats[],
	next: ShareStats,
): readonly ShareStats[] {
	const same = history.filter((stats) => stats.sessionId === next.sessionId);
	return [...same, next].slice(-HISTORY_SECONDS);
}

/** "4:05" ou "1:02:03": quanto tempo desde `since`. */
export function formatElapsed(since: number, now: number): string {
	const total = Math.max(0, Math.floor((now - since) / 1000));
	const hours = Math.floor(total / 3600);
	const minutes = Math.floor((total % 3600) / 60);
	const seconds = String(total % 60).padStart(2, "0");
	return hours > 0
		? `${hours}:${String(minutes).padStart(2, "0")}:${seconds}`
		: `${minutes}:${seconds}`;
}

/** "agora" ou "há 12 min": há quanto tempo alguém começou a assistir. */
export function watchingFor(since: number, now: number): string {
	const minutes = Math.floor((now - since) / 60_000);
	if (minutes < 1) return "agora";
	if (minutes < 60) return `há ${minutes} min`;
	return `há ${Math.floor(minutes / 60)} h`;
}
