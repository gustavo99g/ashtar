/** Os textos do bilhete a partir do que a API devolve. */

/** O endereço sem o protocolo e sem o código, em letra miúda no bilhete: `ashtar.exemplo.ts.net/invite/`. */
export function inviteAddress(link: string, code: string): string {
	const withoutScheme = link.replace(/^https?:\/\//, "");
	return withoutScheme.endsWith(code)
		? withoutScheme.slice(0, withoutScheme.length - code.length)
		: withoutScheme;
}

const timeFormat = new Intl.DateTimeFormat("pt-BR", {
	hour: "2-digit",
	minute: "2-digit",
});

/** "12:20": a hora em que vence, no fuso do computador. `expiresAt` em segundos (Unix). */
export function expiryTime(expiresAt: number): string {
	return timeFormat.format(new Date(expiresAt * 1000));
}
