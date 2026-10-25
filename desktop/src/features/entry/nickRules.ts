/**
 * As regras do nick, as mesmas da API (`validate_nick`, em `api/src/identity/users.rs`), para
 * avisar enquanto a pessoa digita. Quem decide é a API: se as duas discordarem, vale a recusa
 * dela, que volta para o campo.
 *
 * Na API: sem espaços nas pontas, de 2 a 32 caracteres (contados como o `chars().count()` do Rust,
 * um por letra, acento incluído), só letras, números, espaço, `_`, `-` e `.` (o `is_alphanumeric`
 * do Rust), sem dois espaços seguidos.
 */

export const NICK_MIN = 2;
export const NICK_MAX = 32;

/** `\p{Alphabetic}` e `\p{N}` são as duas metades do `char::is_alphanumeric` do Rust. */
const ALLOWED = /^[\p{Alphabetic}\p{N} _.-]*$/u;

export interface NickCheck {
	/** O nick sem espaços nas pontas: o que vai para a API. */
	nick: string;
	/** Pode ir para a API. */
	valid: boolean;
	/** O que aparece em vermelho embaixo do campo, ou `null`. */
	error: string | null;
	/** A ajuda embaixo do campo quando não há erro. */
	hint: string;
}

/** Confere o nick como a API confere. As mensagens de erro são as dela. */
export function checkNick(input: string): NickCheck {
	const nick = input.trim();
	const length = Array.from(nick).length;

	let error: string | null = null;
	if (!ALLOWED.test(nick))
		error = "Use só letras, números, espaço, _, - e ponto no nick.";
	else if (nick.includes("  "))
		error = "O nick não pode ter dois espaços seguidos.";
	else if (length > NICK_MAX)
		error = "O nick precisa ter de 2 a 32 caracteres.";

	// Curto demais não fica vermelho: a pessoa ainda está digitando.
	let hint = "De 2 a 32 caracteres: letras, números, espaço, _, - e ponto.";
	if (length > 0 && length < NICK_MIN)
		hint = "O nick precisa ter pelo menos 2 caracteres.";
	else if (length >= NICK_MIN)
		hint = "O nome que aparece para o grupo você troca quando quiser.";

	return { nick, valid: error === null && length >= NICK_MIN, error, hint };
}

/**
 * Se os dois são o mesmo nick para a API. O banco compara com `COLLATE NOCASE`, que só ignora a
 * caixa das letras sem acento: "Kid" e "kid" são o mesmo nick, "JOÃO" e "joão" não.
 */
export function sameNick(a: string, b: string): boolean {
	return asciiLower(a.trim()) === asciiLower(b.trim());
}

function asciiLower(text: string): string {
	return text.replace(/[A-Z]/g, (letter) => letter.toLowerCase());
}
