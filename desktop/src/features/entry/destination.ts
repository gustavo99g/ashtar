/**
 * Para onde a entrada vai, pela sessão (`features/identity`) e pelo link que chegou. A abertura
 * (`routes/start`) e o `LinkWatcher` decidem pela mesma regra:
 *
 * | Sessão | Sem link | Com link |
 * |---|---|---|
 * | `connected` | tela do servidor | "Você já está no Ashtar" (o convite não é usado) |
 * | `noAccount` | "Você precisa de um convite" | o convite: nick ou recuperação |
 * | `leftGroup` | "Este computador saiu do grupo" | o convite: nick ou recuperação |
 * | `entering`, `error` | fica onde está (`null`) | fica onde está, e o link espera |
 */
import type { Session } from "@/features/identity";
import { paths } from "@/lib/paths";
import type { InviteLink } from "./inviteLink";

export function entryDestination(
	session: Session,
	link: InviteLink | null,
): string | null {
	switch (session.status) {
		case "entering":
		case "error":
			return null;
		case "connected":
			return link ? paths.entry.alreadyIn : paths.server;
		case "noAccount":
			return link ? invitePath(link) : paths.entry.noInvite;
		case "leftGroup":
			return link ? invitePath(link) : paths.entry.leftGroup;
	}
}

/**
 * A tela do convite. O código sozinho começa pela do nick: se a API disser que é uma
 * recuperação, a tela troca (`routes/entry`).
 */
export function invitePath(link: InviteLink): string {
	return link.kind === "recovery"
		? paths.entry.recovery(link.code)
		: paths.entry.invite(link.code);
}
