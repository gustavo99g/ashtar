/**
 * O que a pessoa cola no campo da entrada, ou o link que abriu o app, virando um convite.
 *
 * Aceita o link da página (`https://…/invite/CÓDIGO`, `https://…/recovery/CÓDIGO`), o do app
 * (`ashtar://…`, `ashtar-dev://…`), o link no meio de uma mensagem e o código sozinho, com ou sem
 * hífens, em maiúsculas ou minúsculas. O caminho diz o tipo; o código sozinho não diz, e quem
 * decide é a API (`GET /api/invites/{código}`).
 *
 * O código é conferido como a API faz (`normalize_invite_code`, em `api/src/secret.rs`): sem
 * hífens nem espaços, em maiúsculas, `O` vira `0`, `I` e `L` viram `1`, e sobram 12 caracteres
 * do alfabeto Crockford. O endereço do site não é conferido: o código só vai para a API do
 * próprio app, que o confere de novo.
 */

/** `new`: convite para entrar; `recovery`: recuperação da conta; `unknown`: só o código. */
export type InviteLinkKind = "new" | "recovery" | "unknown";

export interface InviteLink {
	kind: InviteLinkKind;
	/** O código no formato em que a API o gera, `XXXX-XXXX-XXXX`. */
	code: string;
}

/** Alfabeto Crockford: sem I, L, O e U, que confundem na hora de digitar. */
const ALPHABET = /^[0-9ABCDEFGHJKMNPQRSTVWXYZ]{12}$/;

/**
 * O caminho do convite em qualquer link: `invite/` ou `recovery/`, logo depois de uma barra
 * (`https://site/invite/…`, `ashtar://invite/…`) ou no começo. O código vai até o primeiro
 * caractere que não é letra, número ou hífen (barra, `?`, ponto final da mensagem, espaço).
 */
const LINK_PATH = /(?:^|\/)(invite|recovery)\/([0-9A-Za-z-]+)/i;

/**
 * Lê um convite do texto. `null` quando não é um link de convite nem um código válido.
 */
export function parseInviteLink(text: string): InviteLink | null {
	const trimmed = text.trim();
	const link = LINK_PATH.exec(trimmed);
	if (link) {
		const code = normalizeInviteCode(link[2]);
		if (code === null) return null;
		return {
			kind: link[1].toLowerCase() === "invite" ? "new" : "recovery",
			code,
		};
	}
	const code = normalizeInviteCode(trimmed);
	return code === null ? null : { kind: "unknown", code };
}

/**
 * O código como a API o aceita, no formato `XXXX-XXXX-XXXX`, ou `null` se não for um código.
 */
export function normalizeInviteCode(input: string): string | null {
	const code = Array.from(input)
		.filter((char) => char !== "-" && !/\s/u.test(char))
		.map((char) => {
			// Como o `to_ascii_uppercase` do Rust: só as letras sem acento mudam.
			const upper = /[a-z]/.test(char) ? char.toUpperCase() : char;
			if (upper === "O") return "0";
			if (upper === "I" || upper === "L") return "1";
			return upper;
		})
		.join("");
	if (!ALPHABET.test(code)) return null;
	return `${code.slice(0, 4)}-${code.slice(4, 8)}-${code.slice(8)}`;
}
