/**
 * Até quando um convite vale, como o canvas escreve: "hoje, 21:35" ou "24 out, 12:15". Na hora
 * deste computador.
 */

const MONTHS = [
	"jan",
	"fev",
	"mar",
	"abr",
	"mai",
	"jun",
	"jul",
	"ago",
	"set",
	"out",
	"nov",
	"dez",
];

/** `expiresAt` em segundos Unix, como a API manda. `now` é para os testes. */
export function formatValidUntil(
	expiresAt: number,
	now: Date = new Date(),
): string {
	const date = new Date(expiresAt * 1000);
	const time = `${twoDigits(date.getHours())}:${twoDigits(date.getMinutes())}`;
	if (date.toDateString() === now.toDateString()) {
		return `hoje, ${time}`;
	}
	return `${date.getDate()} ${MONTHS[date.getMonth()]}, ${time}`;
}

function twoDigits(value: number): string {
	return String(value).padStart(2, "0");
}
