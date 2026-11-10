/*
 * A cor e a letra do avatar. A cor sai do nick, que não muda; por isso trocar o nome visível não
 * troca a cor. A API (Rust) tem a mesma conta e a mesma lista de casos no teste: as duas nunca
 * podem discordar.
 */

/** A paleta do avatar, nesta ordem. Não é token de tema: é a identidade da pessoa. */
export const NICK_COLORS = [
	"#a16207",
	"#4f46e5",
	"#15803d",
	"#be185d",
	"#0e7490",
	"#c2410c",
	"#7c3aed",
	"#2563eb",
] as const;

const FNV_OFFSET_BASIS = 0x811c9dc5;
const FNV_PRIME = 0x01000193;

/**
 * FNV-1a de 32 bits sobre os bytes UTF-8 do nick, com só as letras ASCII em minúscula
 * (como o `COLLATE NOCASE` do banco: "Kid" e "kid" são o mesmo nick, "JOÃO" e "joão" não
 * mudam o "Ã").
 */
export function nickHash(nick: string): number {
	let hash = FNV_OFFSET_BASIS;
	for (const byte of new TextEncoder().encode(nick)) {
		const lower = byte >= 0x41 && byte <= 0x5a ? byte + 0x20 : byte;
		hash ^= lower;
		// `Math.imul` multiplica em 32 bits; o `>>> 0` deixa o resultado sem sinal.
		hash = Math.imul(hash, FNV_PRIME) >>> 0;
	}
	return hash;
}

/** A posição do nick na paleta: de 0 a 7. */
export function nickColorIndex(nick: string): number {
	return nickHash(nick) % NICK_COLORS.length;
}

/** A cor do avatar de quem tem esse nick. */
export function nickColor(nick: string): string {
	return NICK_COLORS[nickColorIndex(nick)];
}

/**
 * A letra do avatar: a primeira letra (ou número) do nome visível, ou do nick quando não há nome,
 * em maiúscula. Um nome que começa com emoji usa a primeira letra depois dele.
 */
export function avatarInitial(
	nick: string,
	displayName?: string | null,
): string {
	const source = displayName?.trim() || nick;
	const letter =
		source.match(/[\p{L}\p{N}]/u)?.[0] ?? Array.from(source)[0] ?? "?";
	return letter.toLocaleUpperCase("pt-BR");
}
