/*
 * O nome da trilha de tela. A trilha publicada leva no nome quando começou, a qualidade e o título
 * da fonte (`screen-share:{"t":...,"q":"1080p60","s":"Navegador"}`). O nome vai junto com a
 * publicação para todo mundo na sala, assinada ou não, então todos os apps leem a mesma coisa.
 *
 * Desde a v0.4 (ADR 0024), várias pessoas transmitem ao mesmo tempo: o horário só ordena as
 * transmissões (a mais antiga primeiro, `compareShares`), e o limite por sala é da API.
 *
 * O nome não muda depois de publicado. A qualidade pode mudar no meio (o popover e o painel), então
 * quem transmite avisa a nova pela conexão da voz, no tópico `screen-quality` (`{"quality": ...}`),
 * e quem assiste prefere o aviso ao nome (`useShareQuality`).
 */
import type { Quality } from "@/lib/tauri/commands";
import { QUALITY_PRESETS } from "./presets";

const NAME_PREFIX = "screen-share:";

/** O tópico em que quem transmite avisa a qualidade nova. */
export const QUALITY_TOPIC = "screen-quality";

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
	/** A identidade de quem publicou. */
	identity: string;
	/** O nome da trilha de tela publicada. */
	trackName: string | undefined;
}

/**
 * A ordem das transmissões: a que começou antes vem primeiro; sem horário conta como a mais antiga;
 * empate, a menor identidade. Com as mesmas entradas, todo app desenha na mesma ordem.
 */
export function compareShares(a: ShareCandidate, b: ShareCandidate): number {
	const startOf = (candidate: ShareCandidate) =>
		parseShareTrackName(candidate.trackName)?.startedAt ??
		Number.NEGATIVE_INFINITY;
	const byStart = startOf(a) - startOf(b);
	if (byStart !== 0 && !Number.isNaN(byStart)) return byStart < 0 ? -1 : 1;
	return a.identity < b.identity ? -1 : a.identity > b.identity ? 1 : 0;
}

/**
 * O fim da identidade da conexão que transmite a tela de alguém (`{id}:screen`, ADR 0017). Para o
 * resto do app, ela é "a tela de fulano", não um participante a mais.
 *
 * Desde o ADR 0038, um aparelho de transmissão (como o Odin 3) publica a tela do dono numa conexão
 * a mais, `{id}:screen-{aparelho}`: é outra transmissão da mesma pessoa, ao lado da do computador.
 */
export const SCREEN_SUFFIX = ":screen";

/**
 * O dono da identidade de uma tela (`{id}:screen` ou `{id}:screen-{aparelho}`), ou `null` se ela
 * não é de uma tela. Nenhum id de membro tem `:`, então o dono é o que vem antes do primeiro.
 */
function screenOwnerOf(identity: string): string | null {
	const colon = identity.indexOf(":");
	if (colon <= 0) return null;
	const rest = identity.slice(colon);
	const isScreen =
		rest === SCREEN_SUFFIX ||
		(rest.startsWith(`${SCREEN_SUFFIX}-`) &&
			rest.length > SCREEN_SUFFIX.length + 1);
	return isScreen ? identity.slice(0, colon) : null;
}

/** Se a identidade é a de uma tela, do computador ou de um aparelho. */
export function isScreenIdentity(identity: string): boolean {
	return screenOwnerOf(identity) !== null;
}

/** De quem é a identidade: a tela de alguém é desse alguém; o resto é de si mesmo. */
export function shareOwner(identity: string): string {
	return screenOwnerOf(identity) ?? identity;
}

/**
 * A chave de uma transmissão, para tudo que guarda algo por transmissão (o que está aberto, o
 * foco, o volume, o que está à vista): a do computador é o id do dono, como sempre foi; a de um
 * aparelho é a identidade inteira (`{id}:screen-{aparelho}`), para não se misturar com a dele.
 * Uma chave que já é uma chave volta igual.
 */
export function shareKey(identity: string): string {
	return identity.endsWith(SCREEN_SUFFIX) ? shareOwner(identity) : identity;
}

/** Se a chave é a de um aparelho de transmissão. */
export function isDeviceShareKey(key: string): boolean {
	return isScreenIdentity(key);
}

/** A identidade da conexão de uma transmissão, pela chave dela. */
export function screenIdentityOf(key: string): string {
	return isDeviceShareKey(key) ? key : `${key}${SCREEN_SUFFIX}`;
}

/**
 * O nome do aparelho que publica a tela, dos metadados que a API pôs no token
 * (`{"screenOf": ..., "source": "Odin 3"}`), ou `null` na tela do computador.
 */
export function shareSource(metadata: string | undefined): string | null {
	if (!metadata) return null;
	try {
		const parsed: unknown = JSON.parse(metadata);
		if (typeof parsed !== "object" || parsed === null) return null;
		const { source } = parsed as Record<string, unknown>;
		return typeof source === "string" && source.trim() ? source.trim() : null;
	} catch {
		return null;
	}
}

/** "Kid · Odin 3": o nome de quem transmite, com o aparelho quando a tela vem de um. */
export function sharerLabel(name: string, source: string | null): string {
	return source ? `${name} · ${source}` : name;
}

/** "1080p · 30 fps": a qualidade escolhida, para quem assiste. */
export function shareSpec(info: ShareInfo): string {
	return `${QUALITY_PRESETS[info.quality].spec} fps`;
}

const encoder = new TextEncoder();
const decoder = new TextDecoder();

/** O aviso da qualidade nova, para o tópico `screen-quality`. */
export function encodeShareQuality(quality: Quality): Uint8Array {
	return encoder.encode(JSON.stringify({ quality }));
}

/** Um aviso que não é uma qualidade conhecida dá `null`. */
export function decodeShareQuality(payload: Uint8Array): Quality | null {
	try {
		const parsed: unknown = JSON.parse(decoder.decode(payload));
		if (typeof parsed !== "object" || parsed === null) return null;
		const { quality } = parsed as Record<string, unknown>;
		return typeof quality === "string" && quality in QUALITY_PRESETS
			? (quality as Quality)
			: null;
	} catch {
		return null;
	}
}
