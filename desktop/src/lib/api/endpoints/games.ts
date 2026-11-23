import type { DetectableGame } from "../generated";
import { apiFetch } from "../client";
import { isApiError } from "../errors";

/** A lista tem alguns MB: mais tempo que os 10 segundos de sempre. */
const TIMEOUT_MS = 60_000;

/**
 * A lista de jogos detectáveis que a API guarda (ADR 0033, decisão 2). Com o `ETag` da cópia do
 * PC, `null` quando ela não mudou (`304`) ou quando a API ainda não tem lista nenhuma.
 */
export async function getDetectableGames(
	etag: string | null,
): Promise<{ etag: string; games: DetectableGame[] } | null> {
	try {
		const response = await apiFetch(
			"/api/games/detectable",
			etag ? { headers: { "If-None-Match": etag } } : {},
			TIMEOUT_MS,
		);
		const tag = response.headers.get("ETag");
		if (!tag) return null;
		return { etag: tag, games: (await response.json()) as DetectableGame[] };
	} catch (error) {
		if (isApiError(error) && error.status === 304) return null;
		throw error;
	}
}
