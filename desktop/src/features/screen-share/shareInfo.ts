/*
 * Uma transmissão por vez. A trilha de tela publicada leva no nome quando começou, a qualidade e
 * o título da fonte (`screen-share:{"t":...,"q":"720p60","s":"Navegador"}`). O nome vai junto
 * com a publicação para todo mundo na sala, assinada ou não, então todos os apps leem a mesma
 * coisa.
 *
 * Se duas pessoas começam juntas, cada app vê as duas publicações e calcula `shareWinner` sobre
 * elas: com as mesmas entradas, a mesma função dá a mesma resposta nos dois lados, sem nenhuma
 * conversa entre eles. Continua a que começou antes; o horário é o relógio de quem publicou, e uma
 * diferença entre os relógios só muda quem ganha, nunca faz os dois discordarem. Empate (ou sem
 * horário) fica com a menor identidade, que é única na sala: a ordem é total.
 */
import type { Quality } from "@/lib/tauri/commands";
import { QUALITY_PRESETS } from "./presets";

const NAME_PREFIX = "screen-share:";

/** Até onde o título da fonte vai no nome da trilha. */
const TITLE_MAX = 80;

export interface ShareInfo {
	/** `Date.now()` de quem publicou, na hora de publicar. */
	startedAt: number;
	quality: Quality;
	/** O título da janela ou da tela, como o seletor mostra. */
	title: string;
}

export function shareTrackName(info: ShareInfo): string {
	const title = Array.from(info.title).slice(0, TITLE_MAX).join("");
	return (
		NAME_PREFIX +
		JSON.stringify({ t: info.startedAt, q: info.quality, s: title })
	);
}

/** Lê o nome da trilha. Um nome sem as informações (como o `screen-share` antigo) dá `null`. */
export function parseShareTrackName(
	name: string | undefined,
): ShareInfo | null {
	if (!name?.startsWith(NAME_PREFIX)) return null;
	try {
		const parsed: unknown = JSON.parse(name.slice(NAME_PREFIX.length));
		if (typeof parsed !== "object" || parsed === null) return null;
		const { t, q, s } = parsed as Record<string, unknown>;
		if (typeof t !== "number" || !Number.isFinite(t) || typeof s !== "string")
			return null;
		if (typeof q !== "string" || !(q in QUALITY_PRESETS)) return null;
		return { startedAt: t, quality: q as Quality, title: s };
	} catch {
		return null;
	}
}

export interface ShareCandidate {
	/** A identidade de quem publicou (o id do usuário). */
	identity: string;
	/** O nome da trilha de tela publicada. */
	trackName: string | undefined;
}

/**
 * A transmissão que continua quando há mais de uma: a que começou antes; sem horário conta como a
 * mais antiga (quem não diz quando começou não sabe ceder); empate, a menor identidade.
 */
export function shareWinner<T extends ShareCandidate>(
	candidates: readonly T[],
): T | undefined {
	const startOf = (candidate: T) =>
		parseShareTrackName(candidate.trackName)?.startedAt ??
		Number.NEGATIVE_INFINITY;
	return candidates.reduce<T | undefined>((best, candidate) => {
		if (!best) return candidate;
		const a = startOf(candidate);
		const b = startOf(best);
		if (a !== b) return a < b ? candidate : best;
		return candidate.identity < best.identity ? candidate : best;
	}, undefined);
}

/** "1080p · 30 fps": a qualidade escolhida, para quem assiste. */
export function shareSpec(info: ShareInfo): string {
	return `${QUALITY_PRESETS[info.quality].spec} fps`;
}
