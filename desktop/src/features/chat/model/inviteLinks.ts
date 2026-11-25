/**
 * Os links de convite numa mensagem (v0.9, decisão 4 do plano): o app desenha o cartão do convite
 * embaixo do texto, porque a prévia da API nunca busca o próprio servidor (`own_addresses`).
 *
 * Contam o link da página do próprio servidor (`{API}/invite/CÓDIGO`, `{API}/recovery/CÓDIGO`) e
 * o do app (`ashtar://…`, `ashtar-dev://…`). Um `/invite/` de outro site (o do Discord, por
 * exemplo) não conta.
 */
import { type InviteLink, parseInviteLink } from "@/features/entry";
import { apiUrl } from "@/lib/api";

/** No máximo tantos cartões por mensagem. */
export const MAX_INVITE_CARDS = 5;

const LINK = /\b(?:https?|ashtar(?:-dev)?):\/\/[^\s<>]+/giu;

/** A origem da API (`https://api.exemplo`), ou `null` se o app não tiver a URL. */
function apiOrigin(): string | null {
	try {
		return new URL(apiUrl("/")).origin;
	} catch {
		return null;
	}
}

/** Se `url` é um link do próprio servidor do Ashtar. */
export function isOwnServerLink(url: string): boolean {
	const own = apiOrigin();
	if (own === null) return false;
	try {
		return new URL(url).origin === own;
	} catch {
		return false;
	}
}

export interface FoundInvite {
	invite: InviteLink;
	/** O link como está na mensagem, para o Copiar link. */
	url: string;
}

/** Os convites de `body`, sem repetir código, na ordem em que aparecem. */
export function inviteLinksIn(body: string): FoundInvite[] {
	const found: FoundInvite[] = [];
	for (const match of body.matchAll(LINK)) {
		// O ponto ou a vírgula que fecha a frase não fazem parte do link.
		const url = match[0].replace(/[.,;:!?)]+$/u, "");
		const isApp = /^ashtar(?:-dev)?:/i.test(url);
		if (!isApp && !isOwnServerLink(url)) continue;
		const invite = parseInviteLink(url);
		if (!invite || invite.kind === "unknown") continue;
		if (found.some((other) => other.invite.code === invite.code)) continue;
		found.push({ invite, url });
		if (found.length === MAX_INVITE_CARDS) break;
	}
	return found;
}
