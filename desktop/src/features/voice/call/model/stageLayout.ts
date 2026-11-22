/**
 * Como o palco arruma as transmissões abertas (ADR 0024, quadros "Várias telas" do canvas):
 *
 * - uma: ocupa o palco;
 * - duas: lado a lado;
 * - três e quatro: em 2×2;
 * - cinco ou mais, ou uma em foco: a escolhida grande (sem foco, a primeira) e as outras pequenas,
 *   na fileira de baixo.
 *
 * A transmissão "em foco" é a que fica sozinha no palco: a focada ou a única aberta. Só ela tem as
 * ferramentas de ampliar, copiar e ver como está chegando (combinado em 19/11).
 */

export interface StageLayout {
	/** As transmissões grandes, na ordem de desenho. */
	main: string[];
	/** As pequenas, na fileira de baixo. */
	strip: string[];
	/** Quantas colunas o palco tem: 1 (uma só) ou 2 (lado a lado e 2×2). */
	columns: 1 | 2;
	/** A transmissão em foco (sozinha no palco), ou nenhuma. */
	inFocus: string | null;
}

/** Até quantas transmissões o palco divide; a partir daí, uma fica grande. */
export const MAX_SPLIT = 4;

export function stageLayout(
	open: readonly string[],
	focused: string | null,
): StageLayout {
	const chosen =
		focused !== null && open.includes(focused)
			? focused
			: open.length > MAX_SPLIT
				? (open[0] ?? null)
				: null;
	if (chosen !== null) {
		return {
			main: [chosen],
			strip: open.filter((id) => id !== chosen),
			columns: 1,
			inFocus: chosen,
		};
	}
	return {
		main: [...open],
		strip: [],
		columns: open.length > 1 ? 2 : 1,
		inFocus: open.length === 1 ? (open[0] ?? null) : null,
	};
}
