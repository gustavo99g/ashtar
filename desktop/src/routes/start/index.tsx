import { RoutePlaceholder } from "../placeholder";

/**
 * A abertura do app ("Entrando…"). A Etapa 3 faz o login daqui e manda para o servidor ou para a
 * entrada; a Etapa 4 desenha a tela.
 */
export function StartRoute() {
	return <RoutePlaceholder title="Entrando…" stage={4} />;
}
