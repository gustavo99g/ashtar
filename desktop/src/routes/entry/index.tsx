import { RoutePlaceholder } from "../placeholder";

/*
 * As telas da entrada, para quem ainda não tem conta neste computador. Todas chegam na Etapa 4.
 */

/** "Você precisa de um convite", com o campo de colar. */
export function NoInviteRoute() {
	return <RoutePlaceholder title="Você precisa de um convite" stage={4} />;
}

/** A escolha do nick, depois de abrir um convite novo (`:code`). */
export function InviteRoute() {
	return <RoutePlaceholder title="Escolha do nick" stage={4} />;
}

/** A recuperação da conta num computador novo (`:code`). Mostra a conta e não pede nick. */
export function RecoveryRoute() {
	return <RoutePlaceholder title="Recuperação" stage={4} />;
}

/** "Você já está no Ashtar": veio um link, mas este computador já tem conta. */
export function AlreadyInRoute() {
	return <RoutePlaceholder title="Você já está no Ashtar" stage={4} />;
}

/** "Este computador saiu do grupo". A Etapa 3 manda para cá quando o login diz `unknown_device`. */
export function LeftGroupRoute() {
	return <RoutePlaceholder title="Este computador saiu do grupo" stage={4} />;
}
