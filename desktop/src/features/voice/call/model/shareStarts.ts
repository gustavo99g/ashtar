/**
 * Quais transmissões acabaram de começar, para o aviso dentro da sala (ADR 0024). Puro: quem chama
 * (`ShareStartNotices`) guarda o que havia antes e quando cada uma acabou.
 *
 * - Na primeira vez (ao entrar na sala), nada: quem chega não é avisado do que já estava no ar.
 * - Quem parou e voltou em poucos segundos (trocou de fonte, a conexão piscou) não é novidade.
 */

/** Quanto tempo depois de acabar uma transmissão de volta não conta como nova. */
export const RESTART_GRACE_MS = 15_000;

export function startedShares(
	previous: ReadonlySet<string> | null,
	current: readonly string[],
	endedAt: ReadonlyMap<string, number>,
	now: number,
): string[] {
	if (previous === null) return [];
	return current.filter((id) => {
		if (previous.has(id)) return false;
		const ended = endedAt.get(id);
		return ended === undefined || now - ended > RESTART_GRACE_MS;
	});
}

/** "Juju", "Juju e Marcão", "Juju, Marcão e Rafa". */
export function joinNames(names: readonly string[]): string {
	if (names.length <= 1) return names[0] ?? "";
	return `${names.slice(0, -1).join(", ")} e ${names[names.length - 1]}`;
}
